import React, { useMemo } from 'react';
import { ArrowRight, Play, Sparkles } from 'lucide-react';
import type { MediaItem } from '../../types/stream';
import { TmdbArtwork } from './TmdbArtwork';
import './MobileHomeCollections.css';

type Props = {
  items: MediaItem[];
  southIndianMovies?: MediaItem[];
  recent: { media: MediaItem; progress: number; duration: number }[];
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
};

export function MobileHomeCollections({ items, southIndianMovies = [], recent, onOpen, onPlay }: Props) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return items.filter(item => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [items]);
  const genres = ['Action', 'Sci-Fi', 'Thriller', 'Comedy', 'Drama', 'Romance', 'Horror', 'Adventure'];
  const languages = ['Tamil', 'English', 'Hindi', 'Sinhala', 'Telugu', 'Malayalam', 'Kannada', 'Korean'];
  const languageMatch = (value: string, label: string) => value?.toLowerCase() === label.toLowerCase() || ({Tamil:'ta',English:'en',Hindi:'hi',Sinhala:'si',Telugu:'te',Malayalam:'ml',Kannada:'kn',Korean:'ko'} as Record<string,string>)[label] === value?.toLowerCase();
  const movie = unique.filter(x => x.type !== 'tv' && !x.id.startsWith('tv-'));
  const southIndianSelection = [...southIndianMovies, ...movie].filter(item => ['Tamil','Telugu','Malayalam','Kannada'].some(language => languageMatch(item.language, language))).filter((item, i, all) => all.findIndex(x => x.id === item.id) === i);
  const series = unique.filter(x => x.type === 'tv' || x.id.startsWith('tv-'));
  const rows: { label:string; subtitle:string; list: MediaItem[]; kind?: 'continue' }[] = [
    { label:'Trending Movies',subtitle:'Big-screen favourites',list:movie.slice(0,16)},
    { label:'Popular Series',subtitle:'Stories worth following',list:series.slice(0,16)},
    { label:'South Indian Movies',subtitle:'Tamil • Telugu • Malayalam • Kannada cinema',list:southIndianSelection.slice(0,24)},
    ...genres.map(g => ({label:`${g} Movies & Series`,subtitle:'Explore by genre',list:unique.filter(x => x.genres?.some(v => v.toLowerCase() === g.toLowerCase())).slice(0,15)})),
    ...languages.map(l => ({label:`${l} Movies & Series`,subtitle:'Watch in your language',list:unique.filter(x => languageMatch(x.language,l)).slice(0,15)})),
    {label:'Top Rated Picks',subtitle:'Critically loved titles',list:[...unique].filter(x=>Number.parseFloat(x.imdbRating)>0).sort((a,b)=>Number.parseFloat(b.imdbRating)-Number.parseFloat(a.imdbRating)).slice(0,15)},
  ].filter(row => row.list.length > 0);
  const visibleRecent = new Map(recent.map(item => [item.media.id,item]));
  return <div className="flixleo-mobile-collections" aria-label="Explore FlixLeo collections">
    <div className="flixleo-mobile-collections-intro"><Sparkles size={17}/> Explore your universe</div>
    {rows.map(row => <section key={row.label} className="flixleo-mobile-collection" aria-label={row.label}>
      <div className="flixleo-mobile-collection-head"><div><h2>{row.label}</h2><p>{row.subtitle}</p></div><ArrowRight size={19} aria-hidden="true"/></div>
      <div className="flixleo-mobile-collection-scroll">
        {row.list.map(item => {
          const progress = visibleRecent.get(item.id);
          return <div className="flixleo-mobile-collection-card" key={item.id}>
            <button type="button" onClick={() => onOpen(item)} aria-label={`More about ${item.title}`} className="flixleo-mobile-collection-poster">
              <TmdbArtwork media={item} kind="poster" alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="flixleo-mobile-collection-artwork"/>
              {row.kind === 'continue' && progress && progress.duration > 0 && <span className="flixleo-mobile-collection-progress"><span style={{width:`${Math.max(0,Math.min(100, progress.progress / progress.duration * 100))}%`}} /></span>}
            </button>
            <div className="flixleo-mobile-collection-card-foot"><span title={item.title}>{item.title}</span><button type="button" onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}><Play size={12} fill="currentColor"/></button></div>
          </div>;
        })}
      </div>
    </section>)}
  </div>;
}
