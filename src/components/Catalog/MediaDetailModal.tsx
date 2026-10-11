import React from 'react';
import { TmdbArtwork } from './TmdbArtwork';
import {
  X, Play, Bookmark, BookmarkCheck, Download,
  Volume2, Server, Star
} from 'lucide-react';
import { MediaItem, StreamMirror, getSourceDisplayBadge } from '../../types/stream';

interface MediaDetailModalProps {
  media: MediaItem | null;
  isOpen: boolean;
  onClose: () => void;
  onPlayMedia: (media: MediaItem, mirrorId?: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: (media: MediaItem) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  media,
  isOpen,
  onClose,
  onPlayMedia,
  isBookmarked,
  onToggleBookmark
}) => {
  const [selectedSeasonNumber, setSelectedSeasonNumber] = React.useState<number>(media?.seasons?.[0]?.number || 1);
  const [selectedEpisodeId, setSelectedEpisodeId] = React.useState<string | null>(null);
  const [detailedMedia, setDetailedMedia] = React.useState<MediaItem | null>(media);

  const [episodeLoadError, setEpisodeLoadError] = React.useState<string | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = React.useState(false);
  const [addonStreams, setAddonStreams] = React.useState<StreamMirror[]>([]);
  const [addonLoading, setAddonLoading] = React.useState(false);
  const [addonError, setAddonError] = React.useState('');
  const [completedLookupKey, setCompletedLookupKey] = React.useState<string | null>(null);
  const isSeries = Boolean(media && (media.type === 'tv' || media.id.startsWith('tv-')));
  const tmdbId = media?.id.match(/^(?:tmdb-|tv-)(\d+)$/)?.[1];
  const selectedEpisodeNumber = detailedMedia?.seasons?.find(season => season.number === selectedSeasonNumber)
    ?.episodes.find(episode => episode.id === selectedEpisodeId)?.number;
  const lookupKey = isOpen && tmdbId && (!isSeries || selectedEpisodeNumber !== undefined)
    ? [tmdbId, isSeries ? 'series' : 'movie', isSeries ? selectedSeasonNumber : '', isSeries ? selectedEpisodeNumber : ''].join(':')
    : null;
  const waitingForServers = Boolean(lookupKey && completedLookupKey !== lookupKey);
  React.useEffect(() => {
    setAddonStreams([]);
    setAddonError('');
    if (!isOpen || !tmdbId || (isSeries && selectedEpisodeNumber === undefined)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ tmdb: tmdbId, type: isSeries ? 'series' : 'movie' });
    if (isSeries) {
      params.set('season', String(selectedSeasonNumber));
      params.set('episode', String(selectedEpisodeNumber));
    }
    setAddonLoading(true);
    let active = true;
    const deadline = window.setTimeout(() => controller.abort(), 20000);
    fetch('/api/stremio/streams?' + params, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Provider lookup failed');
        return data;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        const streams: StreamMirror[] = (Array.isArray(data.streams) ? data.streams : []).map((stream: any, index: number) => ({
          id: 'stremio-' + index,
          source: 'custom',
          label: (() => {
            const original = String(stream.title || stream.name || '').trim();
            // Display original add-on titles, never URLs, hosts or signed tokens.
            const safeTitle = original
              .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
              .replace(/\b(?:magnet:\?\S+|intent:\/\/\S+)\b/gi, '')
              .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|site|club|fun|tv|xyz)\b/gi, '')
              .trim();
            return safeTitle || String(stream.name || 'Stremio Stream').replace(/(?:https?:\/\/|www\.)\S+/gi, '').trim() || 'Stremio Stream';
          })(),
          quality: /(?:4k|2160p)/i.test(String(stream.title || '') + ' ' + String(stream.name || '')) ? '4K UHD'
            : /1080p/i.test(String(stream.title || '') + ' ' + String(stream.name || '')) ? '1080p'
            : /720p/i.test(String(stream.title || '') + ' ' + String(stream.name || '')) ? '720p'
            : /480p/i.test(String(stream.title || '') + ' ' + String(stream.name || '')) ? '480p'
            : /360p/i.test(String(stream.title || '') + ' ' + String(stream.name || '')) ? '360p'
            : stream.quality === '4K' ? '4K UHD'
            : ['1080p', '720p', '480p', '360p'].includes(stream.quality) ? stream.quality : 'Auto',
          url: stream.url,
          audioFixUrl: stream.audioFixUrl,
          fileSize: typeof stream.fileSize === 'string' && stream.fileSize.trim() ? stream.fileSize.trim() : undefined,
          streamType: stream.streamType === 'hls' ? 'hls' : 'direct-video',
          isDirect: true
        }));
        setAddonStreams(streams);
        if (!streams.length) setAddonError('No streams available');
      })
      .catch(() => { if (active) setAddonError('No streams available'); })
      .finally(() => {
        window.clearTimeout(deadline);
        if (active) {
          setCompletedLookupKey([tmdbId, isSeries ? 'series' : 'movie', isSeries ? selectedSeasonNumber : '', isSeries ? selectedEpisodeNumber : ''].join(':'));
          setAddonLoading(false);
        }
      });
    return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
  }, [isOpen, tmdbId, isSeries, selectedSeasonNumber, selectedEpisodeNumber]);


  React.useEffect(() => {
    if (!media) return;
    setDetailedMedia(media);
    setSelectedEpisodeId(null);
    setSelectedSeasonNumber(media.seasons?.[0]?.number ?? 1);
    setEpisodeLoadError(null);
    if (media.type !== 'tv' && !media.id.startsWith('tv-')) return;
    if (media.seasons?.length) return;
    let cancelled = false;
    setLoadingEpisodes(true);
    fetch(`/api/tmdb/details/tv/${media.id}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok || !data?.success || !data.item) throw new Error(data?.message || 'Episode metadata unavailable');
        return data.item as MediaItem;
      })
      .then(item => {
        if (cancelled) return;
        setDetailedMedia(item);
        setSelectedSeasonNumber(item.seasons?.find(s => s.number === 1)?.number ?? item.seasons?.[0]?.number ?? 1);
      })
      .catch(err => { if (!cancelled) setEpisodeLoadError(err instanceof Error ? err.message : 'Could not load seasons'); })
      .finally(() => { if (!cancelled) setLoadingEpisodes(false); });
    return () => { cancelled = true; };
  }, [media]);

  React.useEffect(() => {
    if (!isOpen || !media || !tmdbId) return;
    const controller = new AbortController();
    const type = isSeries ? 'tv' : 'movie';
    fetch(`/api/tmdb/${type}/${tmdbId}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (controller.signal.aborted || !data?.success || !data.item) return;
        const credits = data.item as MediaItem;
        setDetailedMedia(previous => previous?.id === media.id
          ? { ...previous, director: credits.director, cast: credits.cast }
          : previous);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isOpen, media, tmdbId, isSeries]);

  if (!isOpen || !media) return null;

  const activeMedia = detailedMedia || media;

  if (!activeMedia) return null;
  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'streamhub':
        return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
      case 'vault':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'fastedge':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'remux':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const qualityRank = (mirror: StreamMirror) => {
    const label = mirror.quality.toLowerCase();
    if (/4k|2160p/.test(label)) return 2160;
    if (/1080p/.test(label)) return 1080;
    if (/720p/.test(label)) return 720;
    if (/480p/.test(label)) return 480;
    if (/360p/.test(label)) return 360;
    return 0;
  };
  const orderedMirrors = (mirrors: StreamMirror[]) => [...mirrors, ...addonStreams]
    .filter((mirror, i, all) => all.findIndex(other => other.url === mirror.url) === i)
    .sort((a, b) => qualityRank(b) - qualityRank(a));
  const playSelected = (mirror: StreamMirror, originals: StreamMirror[]) => {
    if (waitingForServers) return;
    onPlayMedia({ ...activeMedia, mirrors: orderedMirrors(originals) }, mirror.id);
    onClose();
  };
  const playInVlc = (mirror: StreamMirror) => {
    try {
      const source = new URL(mirror.url);
      if (source.protocol !== 'https:' || source.username || source.password || mirror.streamType === 'embed-iframe') {
        window.alert('This source cannot be opened directly in VLC.');
        return;
      }
      const intent = 'intent://' + source.href.slice('https://'.length) +
        '#Intent;scheme=https;package=org.videolan.vlc;type=video/*;end';
      window.location.href = intent;
    } catch {
      window.alert('This stream has no supported VLC playback link.');
    }
  };
  const selectedSeason = activeMedia.seasons?.find(s => s.number === selectedSeasonNumber);
  const selectedEpisode = selectedSeason?.episodes.find(e => e.id === selectedEpisodeId);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const isUpcoming = (airDate?: string | null) => Boolean(airDate && /^\d{4}-\d{2}-\d{2}$/.test(airDate) && airDate > todayUtc);
  const formatAirDate = (airDate?: string | null) => {
    if (!airDate || !/^\d{4}-\d{2}-\d{2}$/.test(airDate)) return 'Air date TBA';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(airDate + 'T12:00:00Z'));
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl bg-[#0d111a] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Backdrop Banner with Scrim */}
        <div className="relative h-64 md:h-80 w-full overflow-hidden shrink-0">
          <TmdbArtwork media={activeMedia} kind="backdrop"
            alt={activeMedia.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d111a] via-[#0d111a]/60 to-black/30" />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/70 hover:bg-black border border-slate-700 flex items-center justify-center text-white transition-colors z-10"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Hero text overlay inside banner */}
          <div className="absolute bottom-4 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                {activeMedia.title}
              </h2>
              {activeMedia.originalTitle && activeMedia.originalTitle !== activeMedia.title && (
                <p className="text-xs text-slate-300 italic mt-0.5">
                  {activeMedia.originalTitle}
                </p>
              )}
              {/* Unboxed Metadata Line */}
              <div className="flex items-center gap-2 text-xs text-slate-300 mt-2">
                <span>{activeMedia.year}</span>
                <span aria-hidden="true">·</span>
                <span>{activeMedia.duration}</span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {activeMedia.imdbRating}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeMedia.rating}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => onToggleBookmark(activeMedia)}
                className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-colors ${
                  isBookmarked
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-black/60 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
                title={isBookmarked ? 'Remove from Watchlist' : 'Add to Watchlist'}
                aria-label="Bookmark"
              >
                {isBookmarked ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
              </button>
              <button
                onClick={() => document.getElementById('flixleo-quality-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center gap-2 shadow-lg transition-transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                Choose Quality
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Details & Mirrors */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Overview */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Synopsis
            </h4>
            <p className="text-sm text-slate-200 leading-relaxed max-w-3xl">
              {activeMedia.overview}
            </p>
          </div>

          {/* Cast & Audio Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {activeMedia.director && activeMedia.director !== 'Cinema Director' && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 font-medium">{isSeries ? 'Created by:' : 'Director:'}</span>{' '}
                <span className="text-slate-200 font-semibold">{activeMedia.director}</span>
              </div>
            )}
            {activeMedia.cast?.length && !activeMedia.cast.some(name => ['Lead Cast', 'Co-Star', 'Ensemble'].includes(name)) && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 font-medium">Starring:</span>{' '}
                <span className="text-slate-200">{activeMedia.cast.join(', ')}</span>
              </div>
            )}
            <p className="md:col-span-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-300">
              No audio or sound not working? Use VLC Play to watch with sound. Some 4K audio formats are not supported by your browser.
            </p>
          </div>

          {/* Stream Mirrors or TV Seasons */}
          <div>
            {(activeMedia.type === 'tv' || activeMedia.seasons || activeMedia.id.startsWith('tv-')) ? (
              <div className="space-y-4">
                {!activeMedia.seasons ? (
                  <div className="text-sm text-slate-500 py-4 text-center">Loading episodes...</div>
                ) : (
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {activeMedia.seasons.map((s) => (
                      <button
                        key={s.number}
                        onClick={() => { setSelectedSeasonNumber(s.number); setSelectedEpisodeId(null); }}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                          selectedSeasonNumber === s.number
                            ? 'bg-amber-500 text-black'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Season {s.number}
                      </button>
                    ))}
                  </div>
                )}
                
                {selectedEpisode ? (
                  <div className="space-y-4">
                    <button onClick={() => setSelectedEpisodeId(null)} className="text-sm text-slate-400 hover:text-white">
                      &larr; Back to episodes
                    </button>
                    <h4 className="text-lg font-semibold text-white">Select Quality: {selectedEpisode.title}</h4>
                    <p className="text-xs text-slate-400">{isUpcoming(selectedEpisode.airDate) ? 'Upcoming · ' : selectedEpisode.airDate ? 'Aired · ' : ''}{formatAirDate(selectedEpisode.airDate)}</p>
                    <div className="space-y-2">
                      {waitingForServers && (<div role="status" aria-live="polite" className="relative overflow-hidden rounded-xl border border-amber-400/25 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 shadow-lg shadow-amber-500/5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-xs font-semibold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Discovering streaming sources</span>
                      <span className="text-[11px] text-amber-300">Please wait…</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/80">
                      <div className="h-full w-1/3 animate-[flixleo-source-scan_1.7s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-amber-600 via-amber-300 to-yellow-100" />
                    </div>
                    <style>{`@keyframes flixleo-source-scan {0%{transform:translateX(-100%)} 100%{transform:translateX(300%)}}`}</style>
                    <p className="mt-2 text-[11px] text-slate-400">Playback unlocks after all add-ons respond or the lookup times out.</p>
                  </div>)}
                      {addonError && <p className="text-xs text-slate-500">{addonError}</p>}
                      {orderedMirrors(selectedEpisode.mirrors).map(mirror => (
                        <div key={mirror.id} className="flex items-center gap-2">
                          <button
                            onClick={() => playSelected(mirror, selectedEpisode.mirrors)}
                            disabled={waitingForServers}
                            className="min-w-0 flex-1 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left flex justify-between gap-2"
                          >
                            <span className="break-words">{mirror.label}</span>
                            <span className="shrink-0 text-right text-amber-400">{mirror.quality}{mirror.fileSize && <span className="block text-[11px] text-slate-300">{mirror.fileSize}</span>}</span>
                          </button>
                          <button type="button" disabled={waitingForServers || mirror.streamType === 'embed-iframe'}
                            onClick={() => playInVlc(mirror)}
                            className="shrink-0 rounded-xl border border-orange-500/40 bg-orange-500/15 px-3 py-3 text-xs font-semibold text-orange-200 disabled:opacity-40">
                            VLC Play
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Episodes</h4>
                    <div className="space-y-2">
                      {selectedSeason?.episodes.map((episode) => (
                        <button
                          key={`${selectedSeason.number}-${episode.id}`}
                          onClick={() => { if (!isUpcoming(episode.airDate)) setSelectedEpisodeId(episode.id); }}
                          disabled={isUpcoming(episode.airDate)}
                          className="w-full p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <div className="flex justify-between items-center">
                            <span className="min-w-0 flex flex-col gap-1 pr-3">
                              <span className="text-xs font-semibold text-amber-400">S{String(selectedSeason.number).padStart(2, '0')} · E{String(episode.number).padStart(2, '0')}</span>
                              <span className="text-sm font-medium text-slate-100 break-words">{episode.title || `Episode ${episode.number}`}</span>
                              <span className={`text-xs ${isUpcoming(episode.airDate) ? 'text-sky-300' : 'text-slate-400'}`}>
                                {isUpcoming(episode.airDate) ? 'Upcoming · ' : episode.airDate ? 'Aired · ' : ''}{formatAirDate(episode.airDate)}
                              </span>
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">{episode.duration}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div>
                <div id="flixleo-quality-selector" className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-amber-400" />
                    Select Quality ({orderedMirrors(activeMedia.mirrors).length} Available)
                  </h4>
                </div>
                <div className="space-y-2">
                  {addonLoading && (<div role="status" aria-live="polite" className="relative overflow-hidden rounded-xl border border-amber-400/25 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 shadow-lg shadow-amber-500/5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-xs font-semibold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Discovering streaming sources</span>
                      <span className="text-[11px] text-amber-300">Searching add-ons…</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/80">
                      <div className="h-full w-1/3 animate-[flixleo-source-scan_1.7s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-amber-600 via-amber-300 to-yellow-100" />
                    </div>
                    <style>{`@keyframes flixleo-source-scan {0%{transform:translateX(-100%)} 100%{transform:translateX(300%)}}`}</style>
                    <p className="mt-2 text-[11px] text-slate-400">Existing sources remain available while add-ons respond.</p>
                  </div>)}
                  {addonError && <p className="text-xs text-slate-500">{addonError}</p>}
                  {orderedMirrors(activeMedia.mirrors).map((mirror: StreamMirror) => (
                    <div
                      key={mirror.id}
                      className="p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/40 transition-colors flex flex-row items-center justify-between gap-2 group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase shrink-0 ${getSourceBadge(mirror.source)}`}>
                            {getSourceDisplayBadge(mirror.source)}
                          </span>
                          <h5 className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors truncate">
                            {mirror.label}
                          </h5>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                          <span className="text-amber-400 font-medium">{mirror.quality}</span>
                          {mirror.fileSize && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{mirror.fileSize}</span>
                            </>
                          )}
                          {mirror.bitrate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{mirror.bitrate}</span>
                            </>
                          )}
                          {mirror.serverNode && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-500 truncate">{mirror.serverNode}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            playSelected(mirror, activeMedia.mirrors);
                          }}
                          disabled={waitingForServers}
                          className="px-3 py-2 rounded-lg bg-slate-800 group-hover:bg-amber-500 text-white group-hover:text-black font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          {waitingForServers ? 'Fetching…' : 'Play'}
                        </button>
                        <button type="button" disabled={waitingForServers || mirror.streamType === 'embed-iframe'}
                          onClick={() => playInVlc(mirror)}
                          className="px-3 py-2 rounded-lg border border-orange-500/40 bg-orange-500/15 text-orange-200 font-semibold text-xs disabled:opacity-40">
                          VLC Play
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};