import React from 'react';
import { Home, Film, Tv, Link as LinkIcon, Bookmark } from 'lucide-react';

interface MobileBottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  bookmarkCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  onSelectTab,
  bookmarkCount
}) => {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d14]/95 backdrop-blur-lg border-t border-slate-800/80 px-2 pb-safe">
      <div className="grid grid-cols-4 items-center h-16 max-w-md mx-auto">
        {/* Tab 1: Home */}
        <button
          onClick={() => onSelectTab('browse')}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors"
          aria-label="Home"
        >
          <Home
            className={`w-5 h-5 transition-transform ${
              currentTab === 'browse' ? 'text-amber-400 scale-110' : 'text-slate-400'
            }`}
          />
          <span
            className={`text-[9px] font-medium tracking-tight mt-1 ${
              currentTab === 'browse' ? 'text-amber-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Home
          </span>
        </button>

        {/* Tab 2: Movies */}
        <button
          onClick={() => onSelectTab('movies')}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors"
          aria-label="Movies"
        >
          <Film
            className={`w-5 h-5 transition-transform ${
              currentTab === 'movies' ? 'text-amber-400 scale-110' : 'text-slate-400'
            }`}
          />
          <span
            className={`text-[9px] font-medium tracking-tight mt-1 ${
              currentTab === 'movies' ? 'text-amber-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Movies
          </span>
        </button>

        {/* Tab 3: Series */}
        <button
          onClick={() => onSelectTab('series')}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors"
          aria-label="Series"
        >
          <Tv
            className={`w-5 h-5 transition-transform ${
              currentTab === 'series' ? 'text-amber-400 scale-110' : 'text-slate-400'
            }`}
          />
          <span
            className={`text-[9px] font-medium tracking-tight mt-1 ${
              currentTab === 'series' ? 'text-amber-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Series
          </span>
        </button>

        {/* Tab 4: Watchlist */}
        <button
          onClick={() => onSelectTab('watchlist')}
          className="relative flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors"
          aria-label="Watchlist"
        >
          <Bookmark
            className={`w-5 h-5 transition-transform ${
              currentTab === 'watchlist' ? 'text-amber-400 scale-110' : 'text-slate-400'
            }`}
          />
          {bookmarkCount > 0 && (
            <span className="absolute top-1 right-3 w-3.5 h-3.5 rounded-full bg-amber-500 text-black text-[8px] font-extrabold flex items-center justify-center">
              {bookmarkCount}
            </span>
          )}
          <span
            className={`text-[9px] font-medium tracking-tight mt-1 ${
              currentTab === 'watchlist' ? 'text-amber-400 font-semibold' : 'text-slate-400'
            }`}
          >
            List
          </span>
        </button>
      </div>
    </div>
  );
};