import React, { useEffect, useState } from 'react';
import { Home, Film, Search, Bookmark, Tv, Radio, UserRound, Download, MonitorDown, X, Share2, MoreVertical } from 'lucide-react';
import { SourceType } from '../../types/stream';
import { downloadFlixLeoWindows } from '../../lib/windowsDownload';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedSourceFilter: SourceType | 'all';
  onSelectSourceFilter: (source: SourceType | 'all') => void;
  bookmarkCount: number;
  onOpenProfile: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  bookmarkCount,
  onOpenProfile
}) => {
  const isWindowsExe = Boolean((window as Window & { flixleoDesktop?: unknown }).flixleoDesktop);
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

        {/* Desktop mirrors the mobile bottom navigation destinations. */}
        <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/70 p-1 shadow-inner shadow-black/20">
          {([
            { tab: 'browse', title: 'Home', Icon: Home },
            { tab: 'movies', title: 'Movies', Icon: Film },
            { tab: 'series', title: 'Series', Icon: Tv },
            { tab: 'live', title: 'Live TV', Icon: Radio },
            { tab: 'search', title: 'Search', Icon: Search },
          ] as const).map(({ tab, title, Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onSelectTab(tab)}
              aria-current={currentTab === tab ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-xl px-3 lg:px-4 py-2.5 text-xs lg:text-sm font-semibold transition-all whitespace-nowrap ${
                currentTab === tab
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {title}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open profile"
            className="flex items-center gap-2 rounded-xl px-3 lg:px-4 py-2.5 text-xs lg:text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
          >
            <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            Profile
          </button>
        </nav>

        {/* Desktop bookmark shortcut mirrors the Watchlist link in mobile Profile. */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('watchlist')}
            aria-label={`Open watchlist (${bookmarkCount} saved)`}
            title="My Watchlist"
            className={`hidden lg:flex items-center justify-center relative h-10 w-10 rounded-xl border transition-colors ${
              currentTab === 'watchlist'
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                : 'border-white/10 text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Bookmark className="w-4.5 h-4.5" aria-hidden="true" />
            {bookmarkCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 rounded-full bg-amber-500 px-1 text-[10px] leading-4 text-black font-bold">{bookmarkCount}</span>}
          </button>
          {!isWindowsExe && (platform === 'desktop' ? (/Windows NT/i.test(navigator.userAgent) && (
            <button type="button" onClick={() => void downloadFlixLeoWindows()}
              title="Download FlixLeo Windows app" aria-label="Download FlixLeo Windows app"
              className="hidden sm:inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-amber-300 hover:bg-amber-500/25 hover:border-amber-400 transition-all shrink-0 text-xs font-semibold">
              <MonitorDown className="h-4 w-4" aria-hidden="true" /><span>Download Windows App</span>
            </button>
          )) : !installed && (
            <button type="button" onClick={() => void requestInstall()} title="Install FlixLeo web app" aria-label="Install FlixLeo web app"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 px-2.5 sm:px-3 py-2 text-amber-300 hover:bg-amber-500/25 transition-colors shrink-0 text-xs font-semibold">
              <Download className="w-4 h-4" /><span>Install App</span>
            </button>
          ))}
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