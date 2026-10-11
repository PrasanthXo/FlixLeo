import React, { useState } from 'react';
import { TmdbArtwork } from './TmdbArtwork';
import { Play, Info, Bookmark, BookmarkCheck, MoreVertical } from 'lucide-react';
import { MediaItem, getSourceDisplayBadge } from '../../types/stream';

interface MovieCardProps {
  media: MediaItem;
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  isBookmarked: boolean;
  onToggleBookmark: (media: MediaItem) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  media,
  onPlay,
  onOpenDetails,
  isBookmarked,
  onToggleBookmark
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-xl overflow-hidden bg-slate-900/40 border border-slate-800/80 hover:border-slate-700 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
      {/* Poster Container (Aspect 3:4) */}
      <div className="relative aspect-3/4 w-full overflow-hidden bg-slate-950">
        <button type="button" onClick={() => onOpenDetails(media)} aria-label={`View details for ${media.title}`} className="absolute inset-0 w-full h-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-amber-500 focus-visible:outline-offset-[-2px]">
          <TmdbArtwork media={media} kind="poster" alt={media.title} referrerPolicy="no-referrer" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 pointer-events-none" loading="lazy" />
        </button>

        {/* Gradient Scrim for readable contrast */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Source Badge (Top Left - interactive indicator) */}
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-black/80 backdrop-blur-md text-amber-400 border border-amber-500/30">
            {getSourceDisplayBadge(media.primarySource)}
          </span>
        </div>

        {/* Always-visible mobile friendly watchlist menu */}
        <div className="absolute z-30 top-2 right-2">
          <button type="button" aria-label={`More options for ${media.title}`} aria-expanded={menuOpen}
            onClick={e => { e.stopPropagation(); setMenuOpen(open => !open); }}
            className="h-8 w-8 rounded-full bg-black/85 border border-white/20 text-white flex items-center justify-center shadow-lg backdrop-blur-md">
            <MoreVertical className="h-4 w-4" />
          </button>

        </div>

          {menuOpen && <div className="absolute z-40 top-12 left-1.5 right-1.5 rounded-lg border border-slate-700 bg-[#141923] shadow-2xl p-1">
            <button type="button" onClick={e => { e.stopPropagation(); onToggleBookmark(media); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-2 py-2 text-xs text-left text-white hover:bg-slate-700 rounded-md">
              {isBookmarked ? <BookmarkCheck className="h-4 w-4 text-amber-400" /> : <Bookmark className="h-4 w-4" />}
              {isBookmarked ? 'Remove from List' : 'Add to Watchlist'}
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); setMenuOpen(false); onOpenDetails(media); }} className="w-full px-2 py-2 text-xs text-left text-slate-300 hover:bg-slate-700 rounded-md">View details</button>
          </div>}

        {/* Resolution indicator (Top Right) */}
        {media.resolutionBadge && (
          <div className="absolute top-12 right-2.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-900/90 text-slate-200 border border-slate-700">
              {media.resolutionBadge.includes('4K') ? '4K UHD' : '1080p'}
            </span>
          </div>
        )}

        {/* Hover Quick Actions overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
          <button
            onClick={() => onOpenDetails(media)}
            className="w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center shadow-xl transition-transform active:scale-95"
            title="Choose quality and play"
            aria-label="Choose quality and play"
          >
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          </button>
        </div>

        {/* Bottom hover bar inside image */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
          <button
            onClick={() => onOpenDetails(media)}
            className="px-2.5 py-1.5 rounded-lg bg-black/80 hover:bg-black text-slate-200 hover:text-white border border-slate-700 text-xs font-medium flex items-center gap-1.5 backdrop-blur-md"
            title="View Mirrors & Info"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Mirrors ({media.mirrors.length})</span>
          </button>

          <button
            onClick={() => onToggleBookmark(media)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
              isBookmarked
                ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                : 'bg-black/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title={isBookmarked ? 'In Watchlist' : 'Add to Watchlist'}
            aria-label="Bookmark"
          >
            {isBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Card Body - Anti-slop unboxed metadata */}
      <div className="p-3 flex flex-col flex-1 justify-between">
        <div>
          <h3
            onClick={() => onOpenDetails(media)}
            className="text-sm font-semibold text-slate-100 group-hover:text-amber-400 transition-colors line-clamp-1 cursor-pointer"
            title={media.title}
          >
            {media.title}
          </h3>

          {/* Unboxed Metadata Line with typographic separators */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
            <span>{media.year}</span>
            <span aria-hidden="true">·</span>
            <span>{media.duration}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400/90 font-medium">★ {media.imdbRating}</span>
          </div>
        </div>

        {/* Available source dots */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
          <span className="truncate max-w-[130px]">{media.genres[0]}</span>
          <span className="font-mono text-slate-400">{media.mirrors.length} mirrors</span>
        </div>
      </div>
    </div>
  );
};