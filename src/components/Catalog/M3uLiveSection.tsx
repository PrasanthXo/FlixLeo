import React from 'react';
import { Globe2, Play, RefreshCw, Tv2 } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';

type Channel = { id: string; name: string; logo: string; category: string; country: string; url: string };
type CatalogResponse = { channels?: Channel[]; message?: string; stale?: boolean };

export function M3uLiveSection({ onPlay }: { onPlay: (media: MediaItem, mirrorId?: string) => void }) {
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [country, setCountry] = React.useState('All Countries');
  const [category, setCategory] = React.useState('All Categories');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/live/m3u/channels', { signal: controller.signal })
      .then(async response => {
        const data: CatalogResponse = await response.json();
        if (!response.ok) throw new Error(data.message || 'Playlist unavailable');
        return data;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setChannels(Array.isArray(data.channels) ? data.channels : []);
        if (!data.channels?.length) setError(data.message || 'No channels found in this playlist.');
      })
      .catch(() => { if (!controller.signal.aborted) setError('Playlist channels are temporarily unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const countries = React.useMemo(() => ['All Countries', ...new Set(channels.map(c => c.country))].sort((a,b) => a === 'All Countries' ? -1 : b === 'All Countries' ? 1 : a.localeCompare(b)), [channels]);
  const countryChannels = channels.filter(c => country === 'All Countries' || c.country === country);
  const categories = ['All Categories', ...new Set(countryChannels.map(c => c.category))].sort((a,b) => a === 'All Categories' ? -1 : b === 'All Categories' ? 1 : a.localeCompare(b));
  const visible = countryChannels.filter(c => (category === 'All Categories' || c.category === category) && c.name.toLowerCase().includes(query.toLowerCase().trim()));
  const grouped = Object.entries(Object.groupBy ? Object.groupBy(visible, c => c.category) : visible.reduce<Record<string, Channel[]>>((acc,c) => { (acc[c.category] ||= []).push(c); return acc; }, {}));

  const play = (channel: Channel) => {
    const mirror: StreamMirror = {
      id: 'm3u-' + channel.id, source: 'custom', label: channel.name, quality: 'Auto',
      url: channel.url, streamType: /\\.m3u8(?:$|[?#])/i.test(channel.url) ? 'hls' : 'direct-video',
      isDirect: true
    };
    const media: MediaItem = {
      id: 'm3u-live-' + channel.id, title: channel.name, type: 'movie',
      year: new Date().getFullYear(), duration: 'Live', rating: 'Live', imdbRating: '',
      genres: ['Live TV', channel.category], language: 'Multiple',
      overview: channel.name + ' · ' + channel.country,
      posterUrl: channel.logo, backdropUrl: channel.logo,
      primarySource: 'custom', availableSources: ['custom'], mirrors: [mirror]
    };
    onPlay(media, mirror.id);
  };

  return (
    <section className="mb-9 space-y-5" aria-label="M3U IPTV channels by country and category">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Globe2 className="text-amber-400" size={23} />
          <h2 className="text-xl font-extrabold text-white sm:text-2xl">International Channels</h2>
          <span className="text-xs text-slate-400">{channels.length} channels</span>
        </div>
        <button type="button" onClick={() => setReload(v => v + 1)} aria-label="Refresh IPTV playlist" className="rounded-xl border border-white/15 p-2 text-slate-200 hover:bg-white/10">
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-slate-300">Country
          <select value={country} onChange={e => { setCountry(e.target.value); setCategory('All Categories'); }} className="w-full rounded-xl border border-white/15 bg-[#111b2c] px-3 py-2.5 text-sm text-white">
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-300">Category
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#111b2c] px-3 py-2.5 text-sm text-white">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-300">Search channels
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Channel name" className="w-full rounded-xl border border-white/15 bg-[#111b2c] px-3 py-2.5 text-sm text-white" />
        </label>
      </div>
      {loading && <p className="flex items-center gap-2 text-sm text-slate-300" role="status"><RefreshCw size={16} className="animate-spin" /> Loading playlist…</p>}
      {error && <p role="status" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
      {!loading && !error && visible.length === 0 && <p className="text-sm text-slate-400">No channels match these filters.</p>}
      {grouped.map(([group, items]) => <div key={group} className="rounded-3xl border border-white/10 bg-[#0c1524] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-lg font-bold text-white">{group}</h3><span className="text-xs text-slate-400">{items.length} channels</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map(channel => <button key={channel.id} type="button" onClick={() => play(channel)} className="group overflow-hidden rounded-2xl border border-white/10 bg-[#111e30] text-left hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400">
            <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-slate-700 to-black">
              <Tv2 size={28} className="text-slate-500" />
              {channel.logo && <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-contain p-2" onError={e => { e.currentTarget.style.display = 'none'; }} />}
              <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span>
              <Play size={18} className="absolute bottom-2 right-2 rounded-full bg-amber-400 p-1 text-black" />
            </div>
            <div className="space-y-0.5 px-3 py-2.5"><p className="truncate text-sm font-semibold text-white">{channel.name}</p><p className="truncate text-xs text-slate-400">{channel.country}</p></div>
          </button>)}
        </div>
      </div>)}
    </section>
  );
}
