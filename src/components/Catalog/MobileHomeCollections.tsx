import React, { useMemo } from 'react';
import { ArrowRight, Play, Sparkles } from 'lucide-react';
import type { MediaItem } from '../../types/stream';
import { TmdbArtwork } from './TmdbArtwork';
import './MobileHomeCollections.css';

type Props = {
  items: MediaItem[];
  southIndianMovies?: MediaItem[];
  additionalCollections?: Record<string, MediaItem[]>;
  recent: { media: MediaItem; progress: number; duration: number }[];
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
};

export function MobileHomeCollections({ items, southIndianMovies = [], additionalCollections = {}, recent, onOpen, onPlay }: Props) {
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
  return <div className="flixleo-mobile-collections" aria-label="Explore FlixLeo collections">
    <div className="flixleo-mobile-collections-intro"><Sparkles size={17}/> Explore your universe</div>
    {rows.map(row => <section key={row.label} className="flixleo-mobile-collection" aria-label={row.label}>
      <div className="flixleo-mobile-collection-head"><div><h2>{row.label}</h2><p>{row.subtitle}</p></div><ArrowRight size={19} aria-hidden="true"/></div>
      {row.list.length === 0 ? <p className="flixleo-mobile-collection-empty">No titles available in this collection right now.</p> : <div className="flixleo-mobile-collection-scroll">
        {row.list.map(item => {
          return <div className="flixleo-mobile-collection-card" key={item.id}>
            <button type="button" onClick={() => onOpen(item)} aria-label={`More about ${item.title}`} className="flixleo-mobile-collection-poster">
              <TmdbArtwork media={item} kind="poster" alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="flixleo-mobile-collection-artwork"/>
            </button>
            <div className="flixleo-mobile-collection-card-foot"><span title={item.title}>{item.title}</span><button type="button" onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}><Play size={12} fill="currentColor"/></button></div>
          </div>;
        })}
      </div>}
    </section>)}
  </div>;
}
