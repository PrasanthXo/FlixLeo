import React from 'react';
import { Play, RefreshCw, Tv2 } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';

type TamilChannel = { id: string; name: string; category: string; language: string; country?: string; tvgId?: string; logo: string; url: string; alternateUrls?: string[]; privateProvider?: boolean };

// Keep the Live TV browse menu compact while preserving every source channel.
const LIVE_CATEGORIES = ['News', 'Sports', 'Entertainment', 'Movies & Series', 'Music', 'Kids', 'Documentary', 'Religious', 'Other'] as const;
function compactCategory(raw: string): string {
  const category = (raw || '').toLowerCase();
  if (/news|current affairs|politic|business|finance|weather/.test(category)) return 'News';
  if (/sport|football|cricket|soccer|racing/.test(category)) return 'Sports';
  if (/movie|film|cinema|series|drama/.test(category)) return 'Movies & Series';
  if (/music|radio|audio/.test(category)) return 'Music';
  if (/kid|child|cartoon|animation|family/.test(category)) return 'Kids';
  if (/document|education|science|travel|nature|history|culture/.test(category)) return 'Documentary';
  if (/religion|spiritual|faith|devotion|worship/.test(category)) return 'Religious';
  if (/entertain|general|lifestyle|comedy|variety|classic|comedy|shop/.test(category)) return 'Entertainment';
  return 'Other';
}

export function TamilLiveSection({ onPlay }: { onPlay: (media: MediaItem, mirrorId?: string) => void }) {
  const [channels, setChannels] = React.useState<TamilChannel[]>([]);
  const [category, setCategory] = React.useState('All Categories');
  const [search, setSearch] = React.useState('');
  const [reload, setReload] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.allSettled([
      fetch('/api/live/tamil/channels', { signal: controller.signal }).then(async r => { if (!r.ok) throw Error('Public channels unavailable'); return r.json(); }),
      fetch('/api/live/private/channels', { signal: controller.signal }).then(async r => { if (!r.ok) throw Error('Additional channels unavailable'); return r.json(); })
    ]).then(results => {
      if (controller.signal.aborted) return;
      const publicChannels = results[0].status === 'fulfilled' && Array.isArray(results[0].value.channels) ? results[0].value.channels : [];
      const privateChannels = results[1].status === 'fulfilled' && Array.isArray(results[1].value.channels)
        ? results[1].value.channels.map((ch: TamilChannel) => ({ ...ch, id: 'private-' + ch.id, url: '', privateProvider: true })) : [];
      // Private stream URLs remain server-side; deduplicate public results by metadata.
      const names = new Set(publicChannels.map((ch: TamilChannel) => ch.name.trim().toLowerCase() + '|' + (ch.country || '').toLowerCase()));
      const additional = privateChannels.filter((ch: TamilChannel) => {
        const key = ch.name.trim().toLowerCase() + '|' + (ch.country || '').toLowerCase();
        if (names.has(key)) return false;
        names.add(key);
        return true;
      });
      setChannels([...publicChannels, ...additional]);
      if (!publicChannels.length && !additional.length) setError('No channels available from the configured sources.');
    }).catch(() => { if (!controller.signal.aborted) setError('Live TV temporarily unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  // Some providers omit tvg-country even for well-known Sri Lankan stations.
  const sriLankanStations = /\\b(?:hiru(?:\\s+tv)?|sirasa|shakthi|sakthi|derana|rupavahini|nethra|itn|independent television network|vasantham|siyatha|swarnavahini|shree\\s+fm|charana|monara|tnl\\s*tv|channel\\s*eye|star\\s*tamil\\s*television|imai\\s*tv|ndtv\\s*lanka|supreme\\s*tv|art\\s*tv|tv\\s*1|ada\\s*derana)\\b/i;
  const isLocal = (channel: TamilChannel) => /^(?:LK|LKA|Sri\\s*Lanka)$/i.test((channel.country || '').trim()) ||
    /(?:^|[.])lk(?:[.]|$)/i.test(channel.tvgId || '') ||
    /\\bsri\\s*lanka(?:n)?\\b|\\blanka\\b/i.test(channel.name) ||
    sriLankanStations.test(channel.name);
  const categories = ['All Categories', ...LIVE_CATEGORIES];
  const shown = channels.filter(c => (category === 'All Categories' || compactCategory(c.category) === category) &&
    c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const local = shown.filter(isLocal).sort((a,b) => a.name.localeCompare(b.name));
  const other = shown.filter(c => !isLocal(c));
  const byCategory = other.reduce<Record<string, TamilChannel[]>>((acc,c) => {
    (acc[compactCategory(c.category)] ||= []).push(c);
    return acc;
  }, {});
  const groups = LIVE_CATEGORIES.filter(name => byCategory[name]?.length)
    .map(name => [name, byCategory[name].sort((a,b) => a.name.localeCompare(b.name))] as const);
  const orderedGroups: Array<readonly [string, TamilChannel[]]> = [
    ...(local.length ? [['Sri Lankan Channels', local] as const] : []),
    ...groups
  ];
  async function play(channel: TamilChannel) {
    let primaryUrl = channel.url;
    if (channel.privateProvider) {
      try {
        const response = await fetch('/api/live/private/channel/' + encodeURIComponent(channel.id.slice('private-'.length)));
        if (!response.ok) throw Error('Channel not available');
        const data = await response.json();
        primaryUrl = data.url;
        if (typeof primaryUrl !== 'string' || !primaryUrl.startsWith('/api/live/private/media/')) throw Error('Channel unavailable');
      } catch { setError('This live channel is temporarily unavailable.'); return; }
    }
    const mirrors: StreamMirror[] = [primaryUrl, ...(channel.alternateUrls || [])].map((url, index) => ({
      id: 'iptv-' + channel.id + '-' + index,
      label: index === 0 ? channel.name : channel.name + ' · Backup ' + index,
      url, quality: 'Auto', source: 'custom',
      streamType: channel.privateProvider || /\\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : 'direct-video',
      isDirect: true
    }));
    const media: MediaItem = {
      id: 'iptv-' + channel.id, title: channel.name, type: 'movie', year: new Date().getFullYear(),
      duration: 'Live', rating: 'Live', imdbRating: '', genres: ['Live TV', channel.category],
      language: channel.language, overview: channel.name, posterUrl: channel.logo, backdropUrl: channel.logo,
      primarySource: 'custom', availableSources: ['custom'], mirrors
    };
    onPlay(media, mirrors[0].id);
  }
  return <section className="mb-9 space-y-5" aria-label="Live TV IPTV channels">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-extrabold text-white sm:text-2xl">Live TV</h2>
      <p className="text-sm text-slate-400">{channels.length} channels</p></div>
      <button type="button" aria-label="Refresh live TV channels" onClick={() => setReload(v => v+1)}
        className="rounded-xl border border-white/15 p-2 text-slate-200 hover:bg-white/10"><RefreshCw size={18}/></button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm text-slate-300">Category
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="w-full rounded-xl border border-white/15 bg-[#111b2c] p-3 text-white">
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm text-slate-300">Search channels
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Channel name"
          className="w-full rounded-xl border border-white/15 bg-[#111b2c] p-3 text-white"/>
      </label>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-300"><RefreshCw className="animate-spin" size={16}/>Loading live channels…</p>}
    {error && <p role="status" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
    {!loading && !error && !shown.length && <p className="text-sm text-slate-400">No channels match your filters.</p>}
    {orderedGroups.map(([name, items]) => <div key={name} className="rounded-3xl border border-white/10 bg-[#0c1524] p-4 sm:p-5">
      <div className="mb-4 flex justify-between gap-3"><h3 className="text-lg font-bold text-white">{name}</h3>
        <span className="text-xs text-slate-400">{items.length} channels</span></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(c => <button key={c.id} type="button" onClick={() => void play(c)}
          className="group overflow-hidden rounded-2xl border border-white/10 bg-[#111e30] text-left hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400">
          <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-slate-700 to-black">
            <Tv2 size={28} className="text-slate-500"/>
            {c.logo && <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-contain p-2" onError={e => { e.currentTarget.style.display = 'none'; }}/>}
            <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span>
            <Play size={20} className="absolute bottom-2 right-2 rounded-full bg-amber-400 p-1 text-black"/>
          </div>
          <div className="px-3 py-2.5"><p className="truncate text-sm font-semibold text-white">{c.name}</p><p className="truncate text-xs text-slate-400">{c.language}</p></div>
        </button>)}
      </div>
    </div>)}
  </section>;
}
