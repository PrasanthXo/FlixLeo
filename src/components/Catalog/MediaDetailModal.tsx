import React from 'react';
import { TmdbArtwork } from './TmdbArtwork';
import {
  X, Play, Bookmark, BookmarkCheck, Download,
  Volume2, Globe, Server, Star
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

  React.useEffect(() => {
    if (media && media.type === 'tv' && !media.seasons) {
      fetch(`/api/tmdb/details/tv/${media.id}`)
        .then(r => r.json())
        .then(data => {
          if (data && data.success && data.item) {
            setDetailedMedia(data.item);
          }
        })
        .catch(console.error);
    } else if (media) {
      setDetailedMedia(media);
    }
  }, [media]);
  
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

  const selectedSeason = activeMedia.seasons?.find(s => s.number === selectedSeasonNumber);
  const selectedEpisode = selectedSeason?.episodes.find(e => e.id === selectedEpisodeId);

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
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${getSourceBadge(activeMedia.primarySource)}`}>
                  {getSourceDisplayBadge(activeMedia.primarySource)}
                </span>
                {activeMedia.resolutionBadge && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
                    {activeMedia.resolutionBadge}
                  </span>
                )}
              </div>
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
                onClick={() => {
                  onPlayMedia(activeMedia);
                  onClose();
                }}
                className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center gap-2 shadow-lg transition-transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                Play Default
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
            {activeMedia.director && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 font-medium">Director:</span>{' '}
                <span className="text-slate-200 font-semibold">{activeMedia.director}</span>
              </div>
            )}
            {activeMedia.cast && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 font-medium">Starring:</span>{' '}
                <span className="text-slate-200">{activeMedia.cast.join(', ')}</span>
              </div>
            )}
            {activeMedia.language && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <span className="text-slate-400">Audio / Language:</span>{' '}
                  <span className="text-slate-200 font-semibold">{activeMedia.language}</span>
                </div>
              </div>
            )}
            {activeMedia.audioTracks && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400">Audio Tracks:</span>{' '}
                  <span className="text-slate-200">{activeMedia.audioTracks.join(' · ')}</span>
                </div>
              </div>
            )}
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
                    <div className="space-y-2">
                      {selectedEpisode.mirrors.map(mirror => (
                        <button
                          key={mirror.id}
                          onClick={() => {
                            onPlayMedia(activeMedia, mirror.id);
                            onClose();
                          }}
                          className="w-full p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left flex justify-between"
                        >
                          <span>{mirror.label}</span>
                          <span className="text-amber-400">{mirror.quality}</span>
                        </button>
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
                          onClick={() => setSelectedEpisodeId(episode.id)}
                          className="w-full p-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-200">
                              {episode.number}. {episode.title}
                            </span>
                            <span className="text-xs text-slate-500">{episode.duration}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-amber-400" />
                    Select Streaming Mirror & Server Source ({activeMedia.mirrors.length} Available)
                  </h4>
                </div>
                <div className="space-y-2">
                  {activeMedia.mirrors.map((mirror: StreamMirror) => (
                    <div
                      key={mirror.id}
                      className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
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
                        {mirror.downloadUrl && (
                          <a
                            href={mirror.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                            title="Direct Download"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => {
                            onPlayMedia(activeMedia, mirror.id);
                            onClose();
                          }}
                          className="px-4 py-2 rounded-lg bg-slate-800 group-hover:bg-amber-500 text-white group-hover:text-black font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Stream This Mirror
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