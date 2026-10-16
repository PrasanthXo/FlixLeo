import React from 'react';
import { Play, Radio, RefreshCw, Tv2 } from 'lucide-react';
import type { MediaItem, QualityOption, StreamMirror } from '../../types/stream';

type LiveChannel = {
  id: string;
  type: 'tv' | 'channel';
  name: string;
  poster: string;
  description: string;
  genres: string[];
};
type LiveCatalog = { id: string; type: 'tv' | 'channel'; name: string; items: LiveChannel[] };
type LiveStream = { name: string; url: string; quality: string; streamType: 'hls' | 'direct-video' };

// If the add-on offers only one generic catalog, prefer real genre metadata for channel types.
// Never fabricate channel categories when the provider supplies no such metadata.
function catalogsByChannelType(catalogs: LiveCatalog[]): LiveCatalog[] {
  if (catalogs.length !== 1 || catalogs[0].items.length < 2) return catalogs;
  const original = catalogs[0];
  const grouped = new Map<string, LiveChannel[]>();
  for (const channel of original.items) {
    const genre = (channel.genres || []).find(value => typeof value === 'string' && value.trim());
    const label = genre?.trim() || 'Other Channels';
    grouped.set(label, [...(grouped.get(label) || []), channel]);
  }
  if (grouped.size < 2 || grouped.size > 12) return catalogs;
  return [...grouped.entries()].map(([name, items]) => ({
    id: original.id + ':' + name,
    type: original.type,
    name,
    items
  }));
}

export function PlavioLiveSection({ onPlay }: { onPlay: (media: MediaItem, mirrorId?: string) => void }) {
  const [refreshCount, setRefreshCount] = React.useState(0);
  const [catalogs, setCatalogs] = React.useState<LiveCatalog[]>([]);
  const [selectedType, setSelectedType] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 19000);
    let mounted = true;
    setCatalogs([]);
    setSelectedType('all');
    setLoading(true);
    setError('');
    fetch('/api/stremio/plavio/live/catalog', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Live channels are temporarily unavailable.');
        return response.json();
      })
      .then(data => {
        if (!mounted || controller.signal.aborted) return;
        const parsed: LiveCatalog[] = Array.isArray(data.catalogs)
          ? data.catalogs.filter((catalog: any) => catalog && typeof catalog.id === 'string'
            && typeof catalog.name === 'string' && Array.isArray(catalog.items))
              .map((catalog: LiveCatalog) => ({
                ...catalog,
                items: catalog.items.filter(channel => channel && typeof channel.id === 'string'
                  && typeof channel.name === 'string')
              }))
          : [];
        const groups = catalogsByChannelType(parsed).filter(catalog => catalog.items.length > 0);
        setCatalogs(groups);
        if (!groups.length) setError(
          typeof data.message === 'string' ? data.message : 'No live channels are currently available.'
        );
      })
      .catch(() => {
        if (mounted) setError('Live channels are temporarily unavailable. Try refreshing.');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; window.clearTimeout(timeout); controller.abort(); };
  }, [refreshCount]);

  const playChannel = async (channel: LiveChannel) => {
    if (playingId) return;
    setPlayingId(channel.id);
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 17000);
    try {
      const params = new URLSearchParams({ id: channel.id, type: channel.type });
      const response = await fetch('/api/stremio/plavio/live/streams?' + params, { signal: controller.signal });
      if (!response.ok) throw new Error('No streams available');
      const result = await response.json();
      const candidates: LiveStream[] = Array.isArray(result.streams) ? result.streams : [];
      const mirrors: StreamMirror[] = candidates.filter(s => typeof s.url === 'string' && s.url.startsWith('https://'))
        .map((stream, index) => {
          const quality: QualityOption = stream.quality === '4K' ? '4K UHD'
            : ['1080p', '720p', '480p', '360p'].includes(stream.quality)
              ? stream.quality as QualityOption : 'Auto';
          return {
            id: 'plavio-live-' + index,
            source: 'custom',
            label: stream.name || 'Live TV',
            quality,
            url: stream.url,
            streamType: stream.streamType === 'hls' ? 'hls' : 'direct-video',
            isDirect: true
          };
        });
      if (!mirrors.length) throw new Error('No streams available');
      const media: MediaItem = {
        id: 'plavio-live-' + channel.id, title: channel.name, type: 'movie',
        year: new Date().getFullYear(), duration: 'Live', rating: 'Live', imdbRating: '',
        genres: ['Live TV', ...(channel.genres || [])], language: 'Multiple',
        overview: channel.description || channel.name,
        backdropUrl: channel.poster || '', posterUrl: channel.poster || '',
        primarySource: 'custom', availableSources: ['custom'], mirrors
      };
      onPlay(media, mirrors[0].id);
    } catch {
      setError('No streams available for this channel right now.');
    } finally {
      window.clearTimeout(timeout);
      setPlayingId(null);
    }
  };

  // Hide the entire optional add-on section when it has no real channel catalog.
  if (catalogs.length === 0) return null;

  const visibleCatalogs = selectedType === 'all'
    ? catalogs : catalogs.filter(catalog => catalog.id === selectedType);

  return (
    <section className="mb-9 space-y-6" aria-label="Live TV channel categories">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-300">
            <Radio size={22} />
          </span>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Live TV</h2>
        </div>
        <button type="button" onClick={() => setRefreshCount(value => value + 1)}
          aria-label="Refresh live channels"
          className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
          <RefreshCw size={18} />
        </button>
      </div>

      {catalogs.length > 1 && (
        <nav aria-label="Filter channels by type" className="flex gap-2 overflow-x-auto pb-2">
          {[{ id: 'all', name: 'All Channels' }, ...catalogs].map(catalog =>
            <button key={catalog.id} type="button"
              onClick={() => setSelectedType(catalog.id)}
              aria-pressed={selectedType === catalog.id}
              className={'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ' +
                (selectedType === catalog.id
                  ? 'border-amber-400 bg-amber-400 text-black'
                  : 'border-white/10 bg-slate-900 text-slate-200 hover:border-white/30')}>
              {catalog.name}
            </button>
          )}
        </nav>
      )}

      {loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300" role="status">
          <RefreshCw className="animate-spin text-amber-400" size={18} /> Loading channels…
        </div>
      )}
      {visibleCatalogs.map(catalog => (
        <div key={catalog.id} className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#111b2c] via-[#0b1523] to-[#0e1420] px-3 py-5 sm:p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-extrabold text-white sm:text-xl">{catalog.name}</h3>
            <span className="shrink-0 text-xs font-semibold text-slate-400">{catalog.items.length} channels</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {catalog.items.map(channel => (
              <button key={channel.type + ':' + channel.id} type="button"
                onClick={() => void playChannel(channel)} disabled={Boolean(playingId)}
                title={channel.description || channel.name}
                className="group min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101b2d] text-left transition-colors hover:border-amber-400/70 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-70">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-slate-700 via-slate-900 to-black">
                  <Tv2 size={30} className="text-slate-500" />
                  {channel.poster && (
                    <img src={channel.poster} alt="" loading="lazy" referrerPolicy="no-referrer"
                      className="absolute inset-0 h-full w-full object-contain p-2"
                      onError={event => { event.currentTarget.style.display = 'none'; }} />
                  )}
                  <span className="absolute left-2 top-2 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white">LIVE</span>
                  <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-amber-400 text-black opacity-90 transition-transform group-hover:scale-110">
                    {playingId === channel.id
                      ? <RefreshCw size={15} className="animate-spin" />
                      : <Play size={15} fill="currentColor" />}
                  </span>
                </div>
                <p className="truncate px-3 py-3 text-sm font-semibold text-slate-100">{channel.name}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && catalogs.length > 0 && (
        <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
