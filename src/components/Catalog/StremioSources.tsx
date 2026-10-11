import React from 'react';
import type { MediaItem, StreamMirror } from '../../types/stream';

interface Props {
  media: MediaItem;
  season?: number;
  episode?: number;
  onPlay: (media: MediaItem, mirrorId?: string) => void;
}
type ProviderResult = { provider: string; name: string; title: string; url: string; quality: string; streamType: 'hls' | 'direct-video' };
export const StremioSources: React.FC<Props> = ({ media, season, episode, onPlay }) => {
  const [items, setItems] = React.useState<ProviderResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [enabled, setEnabled] = React.useState(false);
  const tv = media.type === 'tv' || media.id.startsWith('tv-');
  const id = media.id.match(/(?:tv-|tmdb-)(\d+)/)?.[1];
  React.useEffect(() => { setEnabled(false); setItems([]); setError(''); }, [id, season, episode]);
  React.useEffect(() => {
    if (!enabled || !id || (tv && (season === undefined || episode === undefined))) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ type: tv ? 'series' : 'movie', tmdb: id });
    if (tv) { params.set('season', String(season)); params.set('episode', String(episode)); }
    fetch('/api/stremio/streams?' + params, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Provider unavailable'); return data; })
      .then(data => { if (!controller.signal.aborted) setItems(Array.isArray(data.streams) ? data.streams : []); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message || 'Provider unavailable'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, id, tv, season, episode]);
  if (!id || (tv && (season === undefined || episode === undefined))) return null;
  return <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 space-y-3">
    <button type="button" onClick={() => setEnabled(v => !v)} className="w-full flex justify-between items-center text-left text-sm font-semibold text-white">
      <span>Stremio add-on sources</span><span className="text-amber-400">{enabled ? 'Hide' : 'Find streams'}</span>
    </button>
    {enabled && <>
      {loading && <p className="text-xs text-slate-400">Checking configured providers…</p>}
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="text-xs text-slate-400">No compatible HTTPS streams found. Configure approved add-ons on the server. Existing playback remains available.</p>}
      {items.map((item, index) => <button key={item.provider + item.url + index} type="button"
        className="w-full rounded-lg border border-slate-700 p-3 text-left text-sm text-white hover:border-amber-400 flex justify-between gap-2"
        onClick={() => {
          const mirror: StreamMirror = { id: 'stremio-' + index, source: 'custom', label: item.name + ' · ' + item.provider,
            quality: item.quality === '4K' ? '4K UHD' : item.quality === '1080p' ? '1080p' : item.quality === '720p' ? '720p' : 'Auto',
            url: item.url, streamType: item.streamType, isDirect: true };
          onPlay({ ...media, mirrors: [mirror, ...(media.mirrors || [])] }, mirror.id);
        }}>
        <span className="min-w-0 break-words">{item.name}<span className="block text-xs text-slate-400">{item.provider} · {item.title}</span></span>
        <span className="shrink-0 text-amber-400">{item.quality}</span>
      </button>)}
    </>}
  </div>;
};
