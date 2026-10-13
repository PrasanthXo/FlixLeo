import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Play, Sparkles } from 'lucide-react';
import type { MediaItem } from '../../types/stream';
import { TmdbArtwork } from './TmdbArtwork';
import { PosterOptions } from './PosterOptions';
import { WindowsCatalogRail } from './WindowsCatalogRail';
import './MobileHomeCollections.css';

type Props = {
  items: MediaItem[];
  southIndianMovies?: MediaItem[];
  additionalCollections?: Record<string, MediaItem[]>;
  recent: { media: MediaItem; progress: number; duration: number }[];
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  desktopView?: boolean;
  windowsExe?: boolean;
  bookmarkedIds?: string[];
  onToggleBookmark?: (item: MediaItem) => void;
};

export function MobileHomeCollections({ items, southIndianMovies = [], additionalCollections = {}, recent, onOpen, onPlay, bookmarkedIds = [], onToggleBookmark, desktopView = false, windowsExe = false }: Props) {
  const keyboardRoot = useRef<HTMLDivElement>(null);

  // Four-way title navigation, exclusive to the installed Windows app.
  // Never steal arrows from text fields, menus, dialogs or other sections.
  useEffect(() => {
    if (!windowsExe) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

      const root = keyboardRoot.current;
      if (!root) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') ||
          active?.matches('input,textarea,select,[contenteditable="true"]') ||
          active?.closest('[contenteditable="true"],[role="menu"],[role="listbox"],[role="combobox"]')) return;

      // Do not interfere with the top navigation, dialogs, other page controls
      // or accessibility navigation through the three-dot poster menus.
      if (active && active !== document.body && active !== document.documentElement) {
        if (!root.contains(active) || active.closest('.flixleo-mobile-poster-options') ||
            !active.closest('.flixleo-mobile-collection-poster,.flixleo-exe-carousel-track,.flixleo-exe-carousel-arrow')) return;
      }

      const sections = Array.from(root.querySelectorAll<HTMLElement>('.flixleo-mobile-collection'));
      if (!sections.length) return;
      const activeSection = active?.closest<HTMLElement>('.flixleo-mobile-collection') || null;
      let row = activeSection ? sections.indexOf(activeSection) : -1;

      // Start at the most visible Home row when no poster has keyboard focus.
      if (row < 0) {
        const viewCenter = window.innerHeight * 0.4;
        row = sections.reduce((best, section, index) => {
          const rect = section.getBoundingClientRect();
          const distance = rect.bottom < 0 ? -rect.bottom + viewCenter :
            rect.top > window.innerHeight ? rect.top - viewCenter :
            Math.abs((rect.top + rect.bottom) / 2 - viewCenter);
          const old = sections[best].getBoundingClientRect();
          const oldDistance = old.bottom < 0 ? -old.bottom + viewCenter :
            old.top > window.innerHeight ? old.top - viewCenter :
            Math.abs((old.top + old.bottom) / 2 - viewCenter);
          return distance < oldDistance ? index : best;
        }, 0);
      }
      const posters = (section: HTMLElement) =>
        Array.from(section.querySelectorAll<HTMLButtonElement>('.flixleo-mobile-collection-poster'));
      const current = posters(sections[row]);
      if (!current.length) return;
      const focusedPoster = active?.closest<HTMLButtonElement>('.flixleo-mobile-collection-poster') || null;
      let col = focusedPoster ? current.indexOf(focusedPoster) : -1;
      if (col < 0) {
        const rail = sections[row].querySelector<HTMLElement>('.flixleo-exe-carousel-track');
        const leftEdge = rail?.getBoundingClientRect().left ?? 0;
        const first = current.findIndex(button => button.getBoundingClientRect().right > leftEdge + 24);
        col = Math.max(0, first);
      }

      let nextRow = row;
      let nextCol = col;
      if (event.key === 'ArrowLeft') nextCol = Math.max(0, col - 1);
      if (event.key === 'ArrowRight') nextCol = Math.min(current.length - 1, col + 1);
      if (event.key === 'ArrowUp') nextRow = Math.max(0, row - 1);
      if (event.key === 'ArrowDown') nextRow = Math.min(sections.length - 1, row + 1);

      const nextPosters = posters(sections[nextRow]);
      const target = nextPosters[Math.min(nextCol, nextPosters.length - 1)];
      if (!target) return;
      event.preventDefault();
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
      if (nextRow !== row) {
        sections[nextRow].scrollIntoView({ behavior, block: 'center', inline: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [windowsExe]);

  const unique = useMemo(() => {
    const seen = new Set<string>();
    return items.filter(item => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [items]);
  const genres = ['Action', 'Sci-Fi', 'Thriller', 'Comedy', 'Drama', 'Romance', 'Horror', 'Adventure'];
  const languages = ['Tamil', 'English', 'Hindi', 'Sinhala', 'Telugu', 'Malayalam', 'Kannada', 'Korean', 'Japanese'];
  const languageMatch = (value: string, label: string) => value?.toLowerCase() === label.toLowerCase() || ({Tamil:'ta',English:'en',Hindi:'hi',Sinhala:'si',Telugu:'te',Malayalam:'ml',Kannada:'kn',Korean:'ko',Japanese:'ja'} as Record<string,string>)[label] === value?.toLowerCase();
  const movie = unique.filter(x => x.type !== 'tv' && !x.id.startsWith('tv-'));
  const series = unique.filter(x => x.type === 'tv' || x.id.startsWith('tv-'));
  const combined = (key: string, fallback: MediaItem[] = []) =>
    [...(additionalCollections[key] || []), ...fallback]
      .filter((item,i,array) => item?.id && array.findIndex(other => other.id === item.id) === i)
      .slice(0,16);
  const movieGenres = ['Action','Sci-Fi','Thriller','Comedy','Drama','Romance','Horror','Adventure','Fantasy','Mystery','Crime','Animation','Family','Documentary','War','History','Music'];
  const tvGenres = ['Animation','Action','Sci-Fi','Comedy','Drama','Mystery','Crime','Fantasy','Family','Documentary'];
  const providers = ['Netflix','Amazon Prime Video','Disney Plus','Apple TV'];
  const rows: { label:string; subtitle:string; list: MediaItem[] }[] = [
    {label:'Trending Movies',subtitle:'Big-screen favourites',list:movie.slice(0,16)},
    {label:'Popular Series',subtitle:'Stories worth following',list:series.slice(0,16)},
    {label:'Animation Movies',subtitle:'Animated adventures for every age',list:combined('genre:Animation',movie.filter(x => x.genres?.includes('Animation')))},
    {label:'Animation Series',subtitle:'Animated shows and adventures',list:combined('seriesGenre:Animation',series.filter(x => x.genres?.includes('Animation')))},
    {label:'Anime Movies',subtitle:'Japanese animated cinema',list:combined('anime:movies')},
    {label:'Anime Series',subtitle:'Anime shows from Japan',list:combined('anime:series')},
    ...movieGenres.filter(g=>g!=='Animation').map(g=>({
      label:g+' Movies',subtitle:'Explore movies by genre',
      list:combined('genre:'+g,movie.filter(x=>x.genres?.some(v=>v.toLowerCase()===g.toLowerCase())))
    })),
    ...tvGenres.filter(g=>g!=='Animation').map(g=>({
      label:g+' Series',subtitle:'Explore TV shows by genre',
      list:combined('seriesGenre:'+g,series.filter(x=>x.genres?.some(v=>v.toLowerCase()===g.toLowerCase())))
    })),
    ...languages.map(l=>({label:l+' Movies',subtitle:'Movies by original language',
      list:combined('language:'+l,movie.filter(x=>languageMatch(x.language,l)))
    })),
    ...providers.flatMap(provider=>[
      {label:provider+' Movies',subtitle:'Discover titles listed by provider · US region',list:combined('providerMovie:'+provider)},
      {label:provider+' Series',subtitle:'Discover titles listed by provider · US region',list:combined('providerSeries:'+provider)}
    ]),
    {label:'Top Rated Picks',subtitle:'Popular highly rated titles',list:[...unique].filter(x=>Number.parseFloat(x.imdbRating)>0).sort((x,y)=>Number.parseFloat(y.imdbRating)-Number.parseFloat(x.imdbRating)).slice(0,16)},
    ...['STARZ','ZEE5'].flatMap(provider => [
      {label:provider+' Movies',subtitle:'All languages · provider discovery',list:combined('allProviderMovie:'+provider)},
      {label:provider+' Series',subtitle:'All languages · provider discovery',list:combined('allProviderSeries:'+provider)}
    ])
  ].filter(row => row.list.length > 0);
  return <div ref={keyboardRoot} className={desktopView ? 'flixleo-mobile-collections flixleo-native-desktop-collections' : 'flixleo-mobile-collections'} aria-label="Explore FlixLeo collections">
    <div className="flixleo-mobile-collections-intro"><Sparkles size={17}/> Explore your universe
      {windowsExe && <span className="flixleo-exe-keyboard-hint">← → Titles · ↑ ↓ Rows · Enter Details</span>}
    </div>
    {rows.map(row => <section key={row.label} className="flixleo-mobile-collection" aria-label={row.label}>
      <div className="flixleo-mobile-collection-head"><div><h2>{row.label}</h2><p>{row.subtitle}</p></div><ArrowRight size={19} aria-hidden="true"/></div>
      {row.list.length === 0 ? <p className="flixleo-mobile-collection-empty">No titles available in this collection right now.</p> : <WindowsCatalogRail windowsExe={windowsExe} title={row.label} itemCount={row.list.length}>
        {row.list.map(item => {
          return <div className="flixleo-mobile-collection-card relative" key={item.id}>
            <div className="flixleo-mobile-collection-poster-wrap">
            <button type="button" onClick={() => onOpen(item)} aria-label={`More about ${item.title}`} className="flixleo-mobile-collection-poster">
              <TmdbArtwork media={item} kind="poster" alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="flixleo-mobile-collection-artwork"/>
            </button>
            <PosterOptions media={item} onOpen={onOpen} isBookmarked={bookmarkedIds.includes(item.id)} onToggleBookmark={onToggleBookmark} className="flixleo-mobile-poster-options" />
            </div>
            <div className="flixleo-mobile-collection-card-foot"><span title={item.title}>{item.title}</span><button type="button" onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}><Play size={12} fill="currentColor"/></button></div>
          </div>;
        })}
      </WindowsCatalogRail>}
    </section>)}
  </div>;
}
