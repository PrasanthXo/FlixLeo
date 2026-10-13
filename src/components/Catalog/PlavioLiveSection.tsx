import React from 'react';
import { Play, Radio, RefreshCw, Tv2 } from 'lucide-react';
import type { MediaItem, QualityOption, StreamMirror } from '../../types/stream';

type LiveChannel = { id: string; name: string; poster: string; description: string };
type LiveStream = { name: string; url: string; quality: string; streamType: 'hls' | 'direct-video' };
export function PlavioLiveSection({ onPlay }: { onPlay: (media: MediaItem, mirrorId?: string) => void }) {
  const [refreshCount, setRefreshCount] = React.useState(0);
  const [channels, setChannels] = React.useState<LiveChannel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 17000);
    setChannels([]);
    setLoading(true);
    setError('');
    fetch('/api/stremio/plavio/live/catalog', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Live catalog unavailable');
        return response.json();
      })
      .then(data => {
        if (!controller.signal.aborted) {
          setChannels(Array.isArray(data.items) ? data.items : []);
          if (!Array.isArray(data.items) || data.items.length === 0) {
            setError(typeof data.message === 'string' ? data.message : 'No live channels are currently available.');
          }
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError('Live catalog temporarily unavailable. Try refreshing.'); })
      .finally(() => { window.clearTimeout(timeout); setLoading(false); });
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [refreshCount]);

  const playChannel = async (channel: LiveChannel) => {
    if (playingId) return;
    setPlayingId(channel.id);
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 17000);
    try {
      const response = await fetch('/api/stremio/plavio/live/streams?id=' + encodeURIComponent(channel.id), { signal: controller.signal });
      if (!response.ok) throw new Error('No streams available');
      const result = await response.json();
      const candidates: LiveStream[] = Array.isArray(result.streams) ? result.streams : [];
      const mirrors: StreamMirror[] = candidates.filter(s => typeof s.url === 'string' && s.url.startsWith('https://'))
        .map((stream, index) => {
          const quality: QualityOption = stream.quality === '4K' ? '4K UHD'
            : ['1080p', '720p', '480p', '360p'].includes(stream.quality)
              ? stream.quality as QualityOption : 'Auto';
          return {
            id: 'plavio-live-' + index, source: 'custom', label: stream.name || 'PlavioHD Live',
            quality, url: stream.url, streamType: stream.streamType === 'hls' ? 'hls' : 'direct-video', isDirect: true
          };
        });
      if (!mirrors.length) throw new Error('No streams available');
      const media: MediaItem = {
        id: 'plavio-live-' + channel.id, title: channel.name, type: 'movie',
        year: new Date().getFullYear(), duration: 'Live', rating: 'Live', imdbRating: '',
        genres: ['Live TV', 'Sports'], language: 'Multiple',
        overview: channel.description || 'Live sports coverage from PlavioHD.',
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

  return (
    <section className="mb-9 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#101e30] via-[#0b1523] to-[#15101c] p-4 sm:p-6 shadow-xl" aria-label="PlavioHD live sports and TV">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-300"><Radio size={22} /></span>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">Live TV</h2>
            <p className="text-xs text-slate-400">PlavioHD channels · select a channel to play</p>
          </div>
        </div>
        <button type="button" onClick={() => setRefreshCount(value => value + 1)}
          aria-label="Refresh live channels" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-6 text-sm text-slate-300" role="status"><RefreshCw className="animate-spin text-amber-400" size={18} /> Loading live channels…</div>
        : channels.length === 0 ? <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-300">{error || 'No live channels are listed right now.'}</div>
          : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {channels.map(channel => (
              <button key={channel.id} type="button" onClick={() => void playChannel(channel)} disabled={Boolean(playingId)}
                title={channel.description || channel.name}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-[#101b2d] text-left transition-colors hover:border-amber-400/70 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-70">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-slate-700 via-slate-900 to-black">
                  <Tv2 size={30} className="text-slate-500" />
                  {channel.poster && <img src={channel.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-contain p-2" onError={event => { event.currentTarget.style.display = 'none'; }} />}
                  <span className="absolute left-2 top-2 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white">LIVE</span>
                  <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-amber-400 text-black opacity-90 transition-transform group-hover:scale-110">
                    {playingId === channel.id ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
                  </span>
                </div>
                <p className="truncate px-3 py-3 text-sm font-semibold text-slate-100">{channel.name}</p>
              </button>
            ))}
          </div>}
      {error && channels.length > 0 && <p className="mt-4 text-sm font-semibold text-rose-300" role="alert">{error}</p>}
    </section>
  );
}
