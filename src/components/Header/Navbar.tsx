import React, { useEffect, useState } from 'react';
import { Film, Link as LinkIcon, Search, Bookmark, Tv, Download, X, Share2, MoreVertical } from 'lucide-react';
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
  bookmarkCount
}) => {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop');
    const checkInstalled = () => setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as any).standalone));
    checkInstalled();
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    const onInstalled = () => { setInstalled(true); setInstallOpen(false); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const media = window.matchMedia('(display-mode: standalone)');
    media.addEventListener?.('change', checkInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener?.('change', checkInstalled);
    };
  }, []);
  const requestInstall = async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      setInstallPrompt(null);
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') setInstallOpen(false);
      else setInstallOpen(true);
    } else setInstallOpen(true);
  };
  return (
    <header className="sticky top-0 z-40 w-full bg-[#080a0f]/90 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-6">
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
          {!installed && (
            <button type="button" onClick={() => void requestInstall()} title="Install FlixLeo web app" aria-label="Install FlixLeo web app"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 px-2.5 sm:px-3 py-2 text-amber-300 hover:bg-amber-500/25 transition-colors shrink-0 text-xs font-semibold">
              <Download className="w-4 h-4" /><span className="hidden sm:inline">Install App</span>
            </button>
          )}
        </div>
      </div>
      {installOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-24" onClick={() => setInstallOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Install FlixLeo" onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#151922] p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Install FlixLeo</h2>
              <button onClick={() => setInstallOpen(false)} aria-label="Close" className="p-1 rounded-lg hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-slate-300 mb-4">Add FlixLeo to your device to launch it like an app.</p>
            {platform === 'ios' ? (
              <div className="text-sm space-y-3">
                <p>In <b>Safari</b>, tap <Share2 className="inline h-4 w-4" /> <b>Share</b>, then <b>Add to Home Screen</b> (or <b>Add to Dock</b> on supported iPads).</p>
                <p>Tap <b>Add</b> to finish. If you're in another browser, open this page in Safari first.</p>
              </div>
            ) : platform === 'android' ? (
              <div className="text-sm space-y-3">
                <p>In <b>Chrome</b>, tap the <MoreVertical className="inline h-4 w-4" /> menu and select <b>Install app</b> or <b>Add to Home screen</b>.</p>
                <p>If no option appears, open FlixLeo in Chrome and try again.</p>
              </div>
            ) : (
              <div className="text-sm space-y-3">
                <p>In <b>Chrome or Edge</b>, use the install icon in the address bar, or open the browser menu and choose <b>Install FlixLeo</b> / <b>Apps → Install this site as an app</b>.</p>
                <p>Other desktop browsers may only support bookmarks or shortcuts.</p>
              </div>
            )}
            <button type="button" onClick={() => setInstallOpen(false)} className="mt-5 w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-black">Got it</button>
          </section>
        </div>
      )}
    </header>
  );
};