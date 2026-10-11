import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Info, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaItem } from '../../types/stream';
import './CinematicWheel.css';

interface HeroBannerProps {
  media: MediaItem;
  items?: MediaItem[];
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  isBookmarked: boolean;
  onToggleBookmark: (media: MediaItem) => void;
  bookmarkedIds?: string[];
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media, items = [], onPlay, onOpenDetails, isBookmarked,
  onToggleBookmark, bookmarkedIds
}) => {
  const slides = useMemo(() => {
    const candidates = [media, ...items];
    const seen = new Set<string>();
    return candidates.filter(m => {
      if (!m?.id || !m.posterUrl || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, 11);
  }, [media, items]);
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  useEffect(() => setIndex(0), [media.id]);
  const current = slides[index] || media;
  const len = slides.length;
  const move = (delta: number) => setIndex(i => (i + delta + len) % len);
  const selectedSaved = bookmarkedIds ? bookmarkedIds.includes(current.id) : current.id === media.id && isBookmarked;
  return (
    <section className="flixleo-wheel" aria-label="Featured movies and TV series">
      <div className="flixleo-wheel-backdrop" style={{ backgroundImage: current.backdropUrl ? `url("${current.backdropUrl.replace(/"/g, '%22')}")` : undefined }} aria-hidden="true" />
      <div className="flixleo-wheel-vignette" aria-hidden="true" />
      <div className="flixleo-wheel-layout">
        <div className="flixleo-wheel-copy" aria-live="polite">
          <p className="flixleo-wheel-kicker">TRENDING NOW</p>
          <h1>{current.title}</h1>
          <div className="flixleo-wheel-meta">
            <span>{current.year}</span>
            {current.genres?.length > 0 && <><span aria-hidden="true">•</span><span>{current.genres.slice(0, 2).join(' / ')}</span></>}
            {current.duration && <><span aria-hidden="true">•</span><span>{current.duration}</span></>}
            {current.imdbRating && <><span aria-hidden="true">•</span><span>★ {current.imdbRating}</span></>}
          </div>
          <p className="flixleo-wheel-summary">{current.overview}</p>
          <div className="flixleo-wheel-actions">
            <button type="button" className="flixleo-wheel-play" onClick={() => onPlay(current)}><Play size={18} fill="currentColor" /> Play</button>
            <button type="button" className="flixleo-wheel-info" onClick={() => onOpenDetails(current)}><Info size={18} /> More Info</button>
            <button type="button" className="flixleo-wheel-save" aria-label={selectedSaved ? 'Remove from watchlist' : 'Add to watchlist'} title={selectedSaved ? 'Remove from watchlist' : 'Add to watchlist'} onClick={() => onToggleBookmark(current)}>
              {selectedSaved ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
            </button>
          </div>
        </div>
        <div className="flixleo-wheel-stage"
          onTouchStart={e => { startX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={e => { const x = e.changedTouches[0]?.clientX; if (x != null && startX.current != null && Math.abs(x - startX.current) > 45) move(x < startX.current ? 1 : -1); startX.current = null; }}>
          <div className="flixleo-wheel-halo" aria-hidden="true" />
          {len > 1 && <button type="button" className="flixleo-wheel-arrow flixleo-wheel-prev" aria-label="Previous featured title" onClick={() => move(-1)}><ChevronLeft /></button>}
          <div className="flixleo-wheel-track">
            {slides.map((slide, i) => {
              let offset = i - index;
              if (offset > len / 2) offset -= len;
              if (offset < -len / 2) offset += len;
              const distance = Math.abs(offset);
              return <button type="button" key={slide.id} className={'flixleo-wheel-poster' + (offset === 0 ? ' is-selected' : '')}
                style={{ '--wheel-offset': offset, '--wheel-distance': distance, zIndex: 15 - distance, opacity: distance > 3 ? 0 : 1, pointerEvents: distance > 3 ? 'none' : 'auto' } as React.CSSProperties}
                tabIndex={distance > 3 ? -1 : 0}
                aria-label={offset === 0 ? `Featured: ${slide.title}. Open details` : `Select ${slide.title}`}
                aria-current={offset === 0 ? 'true' : undefined}
                onClick={() => offset === 0 ? onOpenDetails(slide) : setIndex(i)}>
                <img src={slide.posterUrl} alt="" loading={distance < 2 ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />
              </button>;
            })}
          </div>
          {len > 1 && <button type="button" className="flixleo-wheel-arrow flixleo-wheel-next" aria-label="Next featured title" onClick={() => move(1)}><ChevronRight /></button>}
          <div className="flixleo-wheel-dots" role="group" aria-label="Featured title selection">
            {slides.slice(0, 11).map((slide, i) => <button type="button" key={slide.id} className={i === index ? 'active' : ''} aria-label={`Show ${slide.title}`} aria-current={i === index ? 'true' : undefined} onClick={() => setIndex(i)} />)}
          </div>
        </div>
      </div>
    </section>
  );
};
