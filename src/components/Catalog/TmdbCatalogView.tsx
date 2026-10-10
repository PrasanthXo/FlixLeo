import React, { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, Star, Globe, RefreshCw, CheckCircle2, Film } from 'lucide-react';
import { MediaItem } from '../../types/stream';
import { MovieCard } from './MovieCard';

interface TmdbCatalogViewProps {
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
  watchlistIds: string[];
  onToggleBookmark: (media: MediaItem) => void;
}

export const TmdbCatalogView: React.FC<TmdbCatalogViewProps> = ({
  onPlay,
  onOpenDetails,
  watchlistIds,
  onToggleBookmark
}) => {
  const [category, setCategory] = useState<'trending' | 'popular' | 'top_rated' | 'indian'>('trending');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const fetchCategory = async (cat: 'trending' | 'popular' | 'top_rated' | 'indian') => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/tmdb/${cat}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          setItems(data.items);
          setIsLive(Boolean(data.isLive));
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to fetch TMDB category:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check TMDB config status
    fetch('/api/tmdb/status')
      .then(r => r.json())
      .then(d => {
        setIsLive(d.configured);
        setStatusMessage(d.message);
      })
      .catch(() => {});

    fetchCategory(category);
  }, [category]);

  const categories = [
    { id: 'trending' as const, label: 'Trending Today', icon: TrendingUp },
    { id: 'popular' as const, label: 'Popular Hits', icon: Sparkles },
    { id: 'top_rated' as const, label: 'Top Rated All-Time', icon: Star },
    { id: 'indian' as const, label: 'South Asian Cinema', icon: Globe },
  ];

  return (
    <div className="space-y-6">
      {/* TMDB Header Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0d1424] to-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#01b4e4]/20 text-[#01b4e4] border border-[#01b4e4]/30 uppercase">
              TMDB v3 API
            </span>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              {isLive ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Live TMDB Connected
                </span>
              ) : (
                <span className="text-amber-400 font-medium">
                  TMDB Curated Catalog Active
                </span>
              )}
            </div>
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
            The Movie Database (TMDB) Master Catalogs
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Stream any trending or blockbuster title with automatic multi-mirror mapping across Ultra 4K, Regional Master, FastStream Edge, and Cloud Vault.
          </p>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => fetchCategory(category)}
          disabled={isLoading}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors self-start md:self-auto shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh TMDB</span>
        </button>
      </div>

      {/* Category Tabs (Segmented Buttons) */}
      <div className="flex items-center gap-2 p-1 bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto no-scrollbar">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-2 transition-all ${
                isActive
                  ? 'bg-amber-500 text-black shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Grid of TMDB Movies */}
      {isLoading ? (
        <div className="py-20 text-center flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-3 border-amber-400 border-t-transparent animate-spin mb-3" />
          <span className="text-xs font-mono text-slate-400">Loading TMDB catalog...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center rounded-2xl bg-slate-900/40 border border-slate-800">
          <Film className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">No movies found in this TMDB category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
          {items.map((movie) => (
            <MovieCard
              key={movie.id}
              media={movie}
              onPlay={onPlay}
              onOpenDetails={onOpenDetails}
              isBookmarked={watchlistIds.includes(movie.id)}
              onToggleBookmark={onToggleBookmark}
            />
          ))}
        </div>
      )}
    </div>
  );
};