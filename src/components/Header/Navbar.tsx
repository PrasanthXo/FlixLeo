import React from 'react';
import { Film, Link as LinkIcon, Search, Bookmark, Tv } from 'lucide-react';
import { SourceType } from '../../types/stream';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedSourceFilter: SourceType | 'all';
  onSelectSourceFilter: (source: SourceType | 'all') => void;
  bookmarkCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  searchQuery,
  onSearchChange,
  bookmarkCount
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-[#080a0f]/90 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          onClick={() => onSelectTab('browse')}
          className="flex items-center gap-2 text-left text-base sm:text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
        >
          <img src="/flixleo-logo.svg" alt="" aria-hidden="true" className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl object-cover" />
          <span>FlixLeo</span>
        </button>

        {/* Zone 2: Nav Links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-300">
          <button
            onClick={() => onSelectTab('browse')}
            className={`whitespace-nowrap shrink-0 transition-colors ${
              currentTab === 'browse' ? 'text-amber-400 font-semibold' : 'hover:text-white'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => onSelectTab('movies')}
            className={`whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
              currentTab === 'movies' ? 'text-amber-400 font-semibold' : 'hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Movies</span>
          </button>
          <button
            onClick={() => onSelectTab('series')}
            className={`whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
              currentTab === 'series' ? 'text-amber-400 font-semibold' : 'hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Series</span>
          </button>
          <button
            onClick={() => onSelectTab('streamhub')}
            className={`whitespace-nowrap shrink-0 transition-colors ${
              currentTab === 'streamhub' ? 'text-sky-400 font-semibold' : 'hover:text-white'
            }`}
          >
            4K Cinema
          </button>
          <button
            onClick={() => onSelectTab('watchlist')}
            className={`whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
              currentTab === 'watchlist' ? 'text-amber-400 font-semibold' : 'hover:text-white'
            }`}
          >
            <span>Watchlist</span>
            {bookmarkCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-amber-300">
                {bookmarkCount}
              </span>
            )}
          </button>
        </nav>

        {/* Zone 3: Search */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Quick Search Input */}
          <div className="relative w-36 min-[380px]:w-44 sm:w-48 lg:w-60">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search movies and TV series"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search movies & series..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>
        </div>
      </div>
    </header>
  );
};