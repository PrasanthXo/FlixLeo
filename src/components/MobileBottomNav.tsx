import React from 'react';
import { Home, Film, Tv, Radio, Search, UserRound } from 'lucide-react';

interface MobileBottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenProfile: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  onSelectTab,
  onOpenProfile
}) => {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d14]/95 backdrop-blur-lg border-t border-slate-800/80 px-2 pb-safe">
      <div className="grid grid-cols-6 items-center h-16 max-w-lg mx-auto">
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

        {/* Dedicated Live TV destination (no live channel row on Home). */}
        <button type="button" onClick={() => onSelectTab('live')}
          aria-label="Live TV" aria-current={currentTab === 'live' ? 'page' : undefined}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors">
          <Radio className={`w-5 h-5 transition-transform ${currentTab === 'live' ? 'text-amber-400 scale-110' : 'text-slate-400'}`} />
          <span className={`text-[9px] font-medium tracking-tight mt-1 ${currentTab === 'live' ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>Live TV</span>
        </button>

        {/* Tab 5: Search, immediately before Profile */}
        <button type="button" onClick={() => onSelectTab('search')}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors" aria-label="Search">
          <Search className={`w-5 h-5 transition-transform ${currentTab === 'search' ? 'text-amber-400 scale-110' : 'text-slate-400'}`} />
          <span className={`text-[9px] font-medium tracking-tight mt-1 ${currentTab === 'search' ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>Search</span>
        </button>

        {/* Tab 6: Profile */}
        <button
          type="button"
          onClick={onOpenProfile}
          className="flex flex-col items-center justify-center min-h-[44px] py-1 transition-colors"
          aria-label="Open profile"
        >
          <UserRound className="w-5 h-5 text-slate-400" />
          <span className="text-[9px] font-medium tracking-tight mt-1 text-slate-400">Profile</span>
        </button>
      </div>
    </div>
  );
};