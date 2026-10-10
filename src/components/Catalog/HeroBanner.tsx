import React from 'react';
import { TmdbArtwork } from './TmdbArtwork';
import { Play, Info, Bookmark, BookmarkCheck, ShieldCheck, Flame, Server } from 'lucide-react';
import { MediaItem } from '../../types/stream';

interface HeroBannerProps {
  media: MediaItem;
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  isBookmarked: boolean;
  onToggleBookmark: (media: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media,
  onPlay,
  onOpenDetails,
  isBookmarked,
  onToggleBookmark
}) => {
  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/80 mb-8 min-h-[380px] md:min-h-[480px] flex items-end">
      {/* Background Image with Measured Contrast Scrim */}
      <TmdbArtwork media={media} kind="backdrop"
        alt={media.title}
        referrerPolicy="no-referrer"
        className="absolute inset-0 w-full h-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#080a0f] via-[#080a0f]/60 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#080a0f] via-[#080a0f]/40 to-transparent" />

      {/* Hero Content Area */}
      <div className="relative z-10 p-6 md:p-10 max-w-3xl">
        {/* Source Badges Row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="px-2.5 py-1 rounded bg-amber-500 text-black text-xs font-extrabold tracking-wide uppercase flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 fill-current" />
            SPOTLIGHT PREMIERE
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-900/90 text-amber-300 border border-amber-500/30 text-xs font-bold">
            {media.resolutionBadge || '4K UHD HDR'}
          </span>
          <span className="px-2.5 py-1 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold">
            {media.mirrors.length} Active Mirrors
          </span>
        </div>

        {/* Title with Balanced Wrap */}
        <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight text-balance leading-tight">
          {media.title}
        </h1>

        {/* Unboxed Metadata (Zero-Pill discipline) */}
        <div className="flex items-center gap-2.5 text-xs md:text-sm text-slate-300 my-3">
          <span>{media.year}</span>
          <span aria-hidden="true">·</span>
          <span>{media.duration}</span>
          <span aria-hidden="true">·</span>
          <span className="text-amber-400 font-semibold">★ {media.imdbRating}</span>
          <span aria-hidden="true">·</span>
          <span>{media.genres.join(', ')}</span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-400">{media.language}</span>
        </div>

        {/* Synopsis */}
        <p className="text-xs md:text-sm text-slate-300 line-clamp-3 md:line-clamp-2 max-w-2xl leading-relaxed mb-6">
          {media.overview}
        </p>

        {/* Supported source nodes ticker preview */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400 mb-6 py-2 px-3 rounded-lg bg-black/40 border border-slate-800/80 backdrop-blur-md max-w-xl">
          <span className="text-slate-500 font-medium flex items-center gap-1">
            <Server className="w-3.5 h-3.5 text-amber-400" />
            Verified Streams:
          </span>
          <span className="text-sky-300">Ultra 4K</span>
          <span aria-hidden="true">·</span>
          <span className="text-pink-300">Regional Master</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-300">FastStream CDN</span>
          <span aria-hidden="true">·</span>
          <span className="text-purple-300">Cloud Vault</span>
        </div>

        {/* Interactive Action Triggers */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onPlay(media)}
            className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center gap-2 shadow-xl shadow-amber-500/10 transition-transform active:scale-95"
          >
            <Play className="w-4 h-4 fill-current" />
            Watch Now (4K UHD)
          </button>

          <button
            onClick={() => onOpenDetails(media)}
            className="py-3 px-5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white border border-slate-700/80 text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            <Info className="w-4 h-4" />
            Select Mirror
          </button>

          <button
            onClick={() => onToggleBookmark(media)}
            className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-colors ${
              isBookmarked
                ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                : 'bg-black/60 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title={isBookmarked ? 'In Watchlist' : 'Add to Watchlist'}
            aria-label="Add to Watchlist"
          >
            {isBookmarked ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};