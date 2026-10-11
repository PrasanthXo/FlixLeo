import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Film, Search, Sparkles, Bookmark, Link as LinkIcon,
  Play, RefreshCw, Layers, CheckCircle2, Tv
} from 'lucide-react';
import { MediaItem, SourceType } from './types/stream';
import { MEDIA_CATALOG, SOURCE_METADATA } from './data/mockCatalog';
import { Navbar } from './components/Header/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { CinemaPlayer } from './components/Player/CinemaPlayer';
import { HeroBanner } from './components/Catalog/HeroBanner';
import { MovieCard } from './components/Catalog/MovieCard';
import { SourceFilterBar } from './components/Catalog/SourceFilterBar';
import { MediaDetailModal } from './components/Catalog/MediaDetailModal';
import { cloudConfigured, currentCloudUser, cloudSignIn, cloudSignUp, cloudSignOut, cloudRead, cloudWrite, mergeCloudData, type CloudUser, type CloudRecord } from './lib/cloudSync';

// Deduplicate repeated TMDB entries by ID and normalized title/year within each media type.
function uniqueTitles(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const type = item.type === 'tv' || item.id.startsWith('tv-') ? 'tv' : 'movie';
    const normalized = item.title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const key = `${type}|${normalized}|${item.year || ''}`;
    const idKey = `${type}|${item.id}`;
    if (seen.has(key) || seen.has(idKey)) return false;
    seen.add(key);
    seen.add(idKey);
    return true;
  });
}

export default function App() {
  // Catalog State
  const [catalog, setCatalog] = useState<MediaItem[]>(MEDIA_CATALOG);
  const [currentTab, setCurrentTab] = useState<string>('browse');
  const [sourceFilter, setSourceFilter] = useState<SourceType | 'all'>('all');
  const [tmdbCategory, setTmdbCategory] = useState<'trending' | 'popular' | 'top_rated' | 'indian' | 'all'>('trending');
  const [tmdbMovies, setTmdbMovies] = useState<MediaItem[]>([]);
  const [isLoadingTmdb, setIsLoadingTmdb] = useState<boolean>(false);
  const [isTmdbLive, setIsTmdbLive] = useState<boolean>(true);

  // TV Series State
  const [tvCategory, setTvCategory] = useState<'trending' | 'popular' | 'top_rated'>('trending');
  const [tvShows, setTvShows] = useState<MediaItem[]>([]);
  const [isLoadingTv, setIsLoadingTv] = useState<boolean>(false);
  // Infinite scrolling is deliberately limited to the Movies and Series tabs.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingNextRef = useRef(false);
  const [movieExtra, setMovieExtra] = useState<MediaItem[]>([]);
  const [tvExtra, setTvExtra] = useState<MediaItem[]>([]);
  const [movieNextPage, setMovieNextPage] = useState(4);
  const [tvNextPage, setTvNextPage] = useState(2);
  const [movieHasMore, setMovieHasMore] = useState(true);
  const [tvHasMore, setTvHasMore] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);


  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tmdbSearchResults, setTmdbSearchResults] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Show the first TMDB catalogue page plus 25 additional unique releases on Home and Movies.
  useEffect(() => {
    if (tmdbCategory === 'all') return;
    const controller = new AbortController();
    setIsLoadingTmdb(true);
    const load = async () => {
      try {
        const fetchPage = async (page: number) => {
          const response = await fetch(`/api/tmdb/${tmdbCategory}?page=${page}`, { signal: controller.signal });
          if (!response.ok) throw new Error('Movie catalogue unavailable');
          const data = await response.json();
          if (!data.success || !Array.isArray(data.items)) throw new Error('Invalid catalogue response');
          return data as { items: MediaItem[]; isLive?: boolean; totalPages?: number };
        };
        const first = await fetchPage(1);
        if (controller.signal.aborted) return;
        const unique = new Map<string, MediaItem>(first.items.map(movie => [movie.id, movie]));
        if (first.isLive) {
          const pageCount = Math.min(3, Math.max(1, first.totalPages || 3));
          const nextPages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, i) => fetchPage(i + 2)));
          let added = 0;
          for (const page of nextPages) {
            for (const movie of page.items) {
              if (added >= 25) break;
              if (!unique.has(movie.id)) {
                unique.set(movie.id, movie);
                added++;
              }
            }
          }
        }
        if (!controller.signal.aborted) {
          setTmdbMovies(uniqueTitles(Array.from(unique.values())));
          setIsTmdbLive(Boolean(first.isLive));
        }
      } catch {
        // Preserve the previous catalogue if TMDB is temporarily unavailable.
      } finally {
        if (!controller.signal.aborted) setIsLoadingTmdb(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [tmdbCategory]);

  // Fetch TMDB TV Series Catalogs
  useEffect(() => {
    setIsLoadingTv(true);
    fetch(`/api/tmdb/tv/${tvCategory}`)
      .then(r => r.json())
      .then(d => {
        if (d && d.success && Array.isArray(d.items)) {
          setTvShows(uniqueTitles(d.items));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingTv(false));
  }, [tvCategory]);

  // Active Playback State
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [activeMirrorId, setActiveMirrorId] = useState<string | undefined>(undefined);
  // Reset pagination whenever the underlying category changes.
  useEffect(() => {
    setMovieExtra([]);
    setMovieNextPage(4);
    setMovieHasMore(true);
    setLoadMoreError('');
  }, [tmdbCategory]);
  useEffect(() => {
    setTvExtra([]);
    setTvNextPage(2);
    setTvHasMore(true);
    setLoadMoreError('');
  }, [tvCategory]);

  const tabCanLoadMore = (currentTab === 'movies' || currentTab === 'series') &&
    !searchQuery.trim() && sourceFilter === 'all' && !activeMedia &&
    (currentTab === 'series' || tmdbCategory !== 'all');
  const isMoreAvailable = currentTab === 'movies' ? movieHasMore : tvHasMore;
  const initialListLoading = currentTab === 'movies' ? isLoadingTmdb : isLoadingTv;
  const liveFeedReady = currentTab === 'series' ? tvShows.length > 0 : isTmdbLive && tmdbMovies.length > 0;

  useEffect(() => {
    if (!tabCanLoadMore || !isMoreAvailable || !liveFeedReady || initialListLoading || loadingMore || loadMoreError) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !loadingNextRef.current) {
        loadingNextRef.current = true;
        setLoadingMore(true);
      }
    }, { rootMargin: '450px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tabCanLoadMore, isMoreAvailable, liveFeedReady, initialListLoading, loadingMore, loadMoreError, currentTab]);

  useEffect(() => {
    if (!loadingMore) return;
    const controller = new AbortController();
    const isMovie = currentTab === 'movies';
    const page = isMovie ? movieNextPage : tvNextPage;
    const category = isMovie ? tmdbCategory : tvCategory;
    const url = isMovie ? `/api/tmdb/${category}?page=${page}` : `/api/tmdb/tv/${category}?page=${page}`;
    const run = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load more titles');
        const result = await response.json();
        if (!result.success || !Array.isArray(result.items)) throw new Error('TMDB returned an invalid page');
        if (!result.isLive || !result.items.length || (typeof result.totalPages === 'number' && page >= result.totalPages)) {
          if (isMovie) setMovieHasMore(false); else setTvHasMore(false);
        }
        if (isMovie) {
          setMovieExtra(prev => {
            const seen = new Set([...tmdbMovies, ...prev].map(item => item.id));
            const combined = uniqueTitles([...tmdbMovies, ...prev, ...result.items]);
            const baseIds = new Set(tmdbMovies.map(item => item.id));
            return combined.filter(item => !baseIds.has(item.id));
          });
          setMovieNextPage(page + 1);
        } else {
          setTvExtra(prev => {
            const seen = new Set([...tvShows, ...prev].map(item => item.id));
            return uniqueTitles([...prev, ...result.items.filter((item: MediaItem) => !seen.has(item.id) && seen.add(item.id))]);
          });
          setTvNextPage(page + 1);
        }
        setLoadMoreError('');
      } catch (error) {
        if (!controller.signal.aborted) setLoadMoreError('Could not load more titles. Tap Retry.');
      } finally {
        if (!controller.signal.aborted) {
          loadingNextRef.current = false;
          setLoadingMore(false);
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [loadingMore, currentTab, tmdbCategory, tvCategory]);
  


  // Modals
  const [detailMedia, setDetailMedia] = useState<MediaItem | null>(null);

  // Persisted native-video resume entries, newest first.
  const [continueWatching, setContinueWatching] = useState<{ media: MediaItem; progress: number; duration: number; updatedAt: number }[]>([]);
  const refreshContinueWatching = React.useCallback(() => {
    try {
      const entries = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      if (Array.isArray(entries)) {
        setContinueWatching(entries.filter(entry => entry?.media?.id && entry.progress >= 5 && (!entry.duration || entry.progress / entry.duration < 0.95)).slice(0, 12));
      }
    } catch { setContinueWatching([]); }
  }, []);
  useEffect(() => { refreshContinueWatching(); }, [refreshContinueWatching]);

  // Watchlist persisted in localStorage
  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cinehub_watchlist');
      return saved ? JSON.parse(saved) : ['stream-overdrive-4k', 'stream-rajputana-warrior'];
    } catch {
      return ['stream-overdrive-4k', 'stream-rajputana-warrior'];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cinehub_watchlist', JSON.stringify(watchlistIds));
    } catch {
      // storage unavailable
    }
  }, [watchlistIds]);

  // Optional Supabase cross-device account. Local storage remains available without login.
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(() => currentCloudUser());
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountNotice, setAccountNotice] = useState('');
  const [cloudReady, setCloudReady] = useState(false);
  const cloudLoadingRef = useRef(false);
  const cloudSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeLocalSnapshot = React.useCallback((): CloudRecord => {
    let history: CloudRecord['history'] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      history = Array.isArray(parsed) ? parsed : [];
    } catch { /* unavailable */ }
    return { watchlist: (() => {
      try {
        const ids = JSON.parse(localStorage.getItem('cinehub_watchlist') || '[]');
        return Array.isArray(ids) ? ids : [];
      } catch { return []; }
    })(), history, updatedAt: Date.now() };
  }, []);
  const loadCloud = React.useCallback(async () => {
    if (!currentCloudUser() || cloudLoadingRef.current) return;
    cloudLoadingRef.current = true;
    setCloudReady(false);
    try {
      const merged = mergeCloudData(makeLocalSnapshot(), await cloudRead());
      localStorage.setItem('cinehub_watchlist', JSON.stringify(merged.watchlist));
      localStorage.setItem('flixleo_continue_watching', JSON.stringify(merged.history));
      setWatchlistIds(merged.watchlist);
      refreshContinueWatching();
      await cloudWrite(merged);
      setCloudReady(true);
      setAccountNotice('Your watchlist and Continue Watching are synced.');
    } catch (error) {
      setAccountNotice(error instanceof Error ? error.message : 'Cloud sync failed; your local data is safe.');
    } finally { cloudLoadingRef.current = false; }
  }, [makeLocalSnapshot, refreshContinueWatching]);
  useEffect(() => { if (cloudUser) void loadCloud(); }, [cloudUser, loadCloud]);
  useEffect(() => {
    if (!cloudUser || !cloudReady) return;
    if (cloudSyncTimer.current) clearTimeout(cloudSyncTimer.current);
    cloudSyncTimer.current = setTimeout(() => {
      void cloudWrite(makeLocalSnapshot()).catch(() => setAccountNotice('Cloud sync failed; local data is still saved.'));
    }, 1200);
    return () => { if (cloudSyncTimer.current) clearTimeout(cloudSyncTimer.current); };
  }, [cloudUser, cloudReady, watchlistIds, continueWatching, makeLocalSnapshot]);
  const submitAccount = async (mode: 'signin' | 'signup') => {
    setAccountBusy(true);
    setAccountNotice('');
    try {
      if (mode === 'signup') {
        const active = await cloudSignUp(accountEmail.trim(), accountPassword);
        if (!active) { setAccountNotice('Check your email to verify your account, then sign in.'); return; }
      } else { await cloudSignIn(accountEmail.trim(), accountPassword); }
      setCloudReady(false);
      setCloudUser(currentCloudUser());
      setAccountPassword('');
    } catch (error) {
      setAccountNotice(error instanceof Error ? error.message : 'Authentication failed.');
    } finally { setAccountBusy(false); }
  };

  // Search live TMDB movies and television together, with cancellation for fast typing.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setTmdbSearchResults([]);
      setSearchLoading(false);
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError('');
    setTmdbSearchResults([]);
    const timer = window.setTimeout(async () => {
      try {
        const endpoints = ['/api/tmdb/search', '/api/tmdb/tv/search'];
        const data = await Promise.all(endpoints.map(async endpoint => {
          const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (!response.ok) throw new Error('TMDB search unavailable');
          const payload = await response.json();
          if (!payload?.success || !Array.isArray(payload.items)) throw new Error('TMDB search unavailable');
          return payload.items as MediaItem[];
        }));
        if (controller.signal.aborted) return;
        const unique = new Map<string, MediaItem>();
        for (const item of data.flat()) unique.set(item.id, item);
        setTmdbSearchResults(uniqueTitles(Array.from(unique.values())));
      } catch (error) {
        if (!controller.signal.aborted) setSearchError('Live search is unavailable. Check the TMDB connection and try again.');
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);

  // Toggle Bookmark
  const toggleBookmark = (media: MediaItem) => {
    setWatchlistIds(prev =>
      prev.includes(media.id) ? prev.filter(id => id !== media.id) : [...prev, media.id]
    );
  };

  // Switch tabs
  const handleSelectTab = (tab: string) => {
    if (['streamhub', 'vault', 'remux', 'fastedge'].includes(tab)) {
      setCurrentTab('browse');
      setSourceFilter(tab as SourceType);
    } else if (tab === 'browse' || tab === 'hubs') {
      setCurrentTab('browse');
      setSourceFilter('all');
    } else {
      setCurrentTab(tab);
    }
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Launch Player
  const handlePlayMedia = (media: MediaItem, mirrorId?: string) => {
    setActiveMedia(media);
    setActiveMirrorId(mirrorId || (media.availableSources.length > 0 ? media.availableSources[0] : undefined));
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };



  // Calculate source counts
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: catalog.length,
      streamhub: 0,
      vault: 0,
      remux: 0,
      fastedge: 0,
    };
    catalog.forEach(item => {
      item.availableSources.forEach(src => {
        if (counts[src] !== undefined) {
          counts[src]++;
        }
      });
    });
    return counts;
  }, [catalog]);

  // Filtered Media
  const filteredCatalog = useMemo(() => {
    let list = catalog;

    // When on Movies tab
    if (currentTab === 'movies') {
      list = tmdbMovies.length > 0 ? [...tmdbMovies, ...movieExtra] : catalog;
    }

    // When on Series tab
    if (currentTab === 'series') {
      const manualSeries = catalog.filter(m => m.id.startsWith('tv-') || m.type === 'tv');
      list = [...tvShows, ...tvExtra, ...manualSeries];
    }

    // When on Home (browse), use TMDB catalog if selected and populated
    if (currentTab === 'browse' && tmdbMovies.length > 0) {
      list = tmdbMovies;
    }

    // Filter by Watchlist Tab
    if (currentTab === 'watchlist') {
      list = catalog.filter(m => watchlistIds.includes(m.id));
    }

    // Filter by Source (Ultra 4K, Cinema Remux, Cloud Vault, FastStream)
    if (sourceFilter !== 'all') {
      list = list.filter(m => m.availableSources.includes(sourceFilter));
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(m =>
        m.title.toLowerCase().includes(q) ||
        (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
        m.genres.some(g => g.toLowerCase().includes(q)) ||
        m.language.toLowerCase().includes(q) ||
        (m.director && m.director.toLowerCase().includes(q)) ||
        (m.cast && m.cast.some(c => c.toLowerCase().includes(q))) ||
        m.availableSources.some(s => s.toLowerCase().includes(q))
      );
    }

    return uniqueTitles(list);
  }, [catalog, currentTab, tmdbCategory, tmdbMovies, tvShows, movieExtra, tvExtra, sourceFilter, searchQuery, watchlistIds]);

  // Spotlight media for hero banner
  const featuredMedia = useMemo(() => {
    if (currentTab === 'series' && tvShows.length > 0) {
      return tvShows[0];
    }
    if ((currentTab === 'browse' || currentTab === 'movies') && tmdbMovies.length > 0) {
      return tmdbMovies[0];
    }
    return catalog.find(m => m.featured) || catalog[0];
  }, [catalog, currentTab, tmdbMovies, tvShows]);

  return (
    <div className="min-h-screen bg-[#080a0f] text-slate-100 flex flex-col selection:bg-amber-500 selection:text-black">
      {/* Top Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedSourceFilter={sourceFilter}
        onSelectSourceFilter={setSourceFilter}
        bookmarkCount={watchlistIds.length}
        onOpenAccount={() => setAccountOpen(true)}
        accountLabel={cloudUser?.email || 'Sign in'}
      />

      {accountOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setAccountOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="FlixLeo account" className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#10151f] p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">FlixLeo Account</h2>
              <button onClick={() => setAccountOpen(false)} className="text-slate-300 hover:text-white" aria-label="Close account window">✕</button>
            </div>
            {!cloudConfigured ? (
              <p className="text-sm text-amber-300">Cloud accounts are not configured yet. The site owner needs to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on Render and run supabase/schema.sql. Your local data is unaffected.</p>
            ) : cloudUser ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-200">Signed in as <strong>{cloudUser.email}</strong></p>
                <p className="text-sm text-slate-400">{cloudReady ? 'Cloud sync active' : 'Cloud sync connecting or waiting for retry'}</p>
                <div className="flex gap-2">
                  <button onClick={() => void loadCloud()} disabled={accountBusy} className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-black">Sync now</button>
                  <button onClick={() => { void cloudSignOut().then(() => { setCloudUser(null); setCloudReady(false); setAccountNotice('Signed out. Local data remains on this device.'); }); }} className="rounded-lg bg-slate-700 px-4 py-2 text-white">Sign out</button>
                </div>
              </div>
            ) : (
              <form onSubmit={e => { e.preventDefault(); void submitAccount('signin'); }} className="space-y-3">
                <p className="text-sm text-slate-400">Sign in on your other devices to sync your watchlist and playback progress.</p>
                <input type="email" required autoComplete="email" placeholder="Email" value={accountEmail} onChange={e => setAccountEmail(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white" />
                <input type="password" required minLength={6} autoComplete="current-password" placeholder="Password" value={accountPassword} onChange={e => setAccountPassword(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white" />
                <div className="flex gap-2">
                  <button type="submit" disabled={accountBusy} className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-black disabled:opacity-50">Sign in</button>
                  <button type="button" disabled={accountBusy || !accountEmail || accountPassword.length < 6} onClick={() => void submitAccount('signup')} className="rounded-lg bg-slate-700 px-4 py-2 text-white disabled:opacity-50">Create account</button>
                </div>
              </form>
            )}
            {accountNotice && <p role="status" className="mt-4 text-sm text-amber-200">{accountNotice}</p>}
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-12">
        {/* Active Cinema Video Player (if active) */}
        {activeMedia && (
          <div className="mb-10 animate-fade-in relative z-30">
            <CinemaPlayer
              media={activeMedia}
              initialMirrorId={activeMirrorId}
              onClose={() => { setActiveMedia(null); refreshContinueWatching(); }}
              onProgressSaved={refreshContinueWatching}
              onMirrorChange={(mirror) => setActiveMirrorId(mirror.id)}
              hasPlayNext={catalog.length > 1}
              onPlayNext={() => {
                const currentIndex = catalog.findIndex(m => m.id === activeMedia.id);
                const nextItem = catalog[(currentIndex + 1) % catalog.length];
                handlePlayMedia(nextItem);
              }}
            />
          </div>
        )}

        {currentTab === 'browse' && !searchQuery.trim() && continueWatching.length > 0 && (
          <section className="mb-8" aria-label="Continue Watching">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">Continue Watching</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-3">
              {continueWatching.map(entry => (
                <button key={entry.media.id} type="button"
                  onClick={() => {
                    handlePlayMedia(entry.media);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="group text-left w-40 sm:w-48 shrink-0 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 hover:border-amber-500 focus-visible:outline-2 focus-visible:outline-amber-400"
                  aria-label={`Resume ${entry.media.title}`}>
                  <div className="relative aspect-video bg-slate-950">
                    {entry.media.backdropUrl && <img src={entry.media.backdropUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    <span className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/80 text-amber-300 text-xs font-bold">▶ Resume</span>
                    <div className="absolute bottom-0 left-0 right-0 bg-slate-700 h-1">
                      <div className="bg-amber-500 h-full" style={{ width: `${entry.duration > 0 ? Math.min(100, Math.round(entry.progress / entry.duration * 100)) : 0}%` }} />
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-sm text-white font-medium truncate">{entry.media.title}</p>
                    <p className="text-xs text-slate-400">{Math.floor(entry.progress / 60)} min watched</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Spotlight Hero Banner */}
        {(['browse', 'movies', 'series'].includes(currentTab)) && sourceFilter === 'all' && !searchQuery && !activeMedia && featuredMedia && (
          <HeroBanner
            media={featuredMedia}
            onPlay={(m) => handlePlayMedia(m)}
            onOpenDetails={(m) => setDetailMedia(m)}
            isBookmarked={watchlistIds.includes(featuredMedia.id)}
            onToggleBookmark={toggleBookmark}
          />
        )}

        {/* TMDB Movie Catalogs Selector */}
        {(currentTab === 'browse' || currentTab === 'movies') && !searchQuery && (
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0a101d] to-slate-950 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#01b4e4]/20 text-[#01b4e4] border border-[#01b4e4]/30 uppercase">
                TMDB Movies v3
              </span>
              <span className="text-xs text-slate-300 font-semibold">
                Movie Catalogs ({filteredCatalog.length} releases)
              </span>
              {isLoadingTmdb && (
                <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin ml-1" />
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'trending' as const, label: '🔥 Trending Today' },
                { id: 'popular' as const, label: '⭐ Popular Hits' },
                { id: 'top_rated' as const, label: '🏆 Top Rated' },
                { id: 'indian' as const, label: '🎬 South Asian Cinema' },
                { id: 'all' as const, label: '💎 All Releases' },
              ].map((cat) => {
                const isActive = tmdbCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setTmdbCategory(cat.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                      isActive
                        ? 'bg-[#01b4e4] text-black font-bold shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TMDB TV Series Catalogs Selector */}
        {currentTab === 'series' && !searchQuery && (
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0a101d] to-slate-950 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/25 text-purple-300 border border-purple-500/30 uppercase">
                TMDB TV Series
              </span>
              <span className="text-xs text-slate-300 font-semibold">
                Series & Shows ({filteredCatalog.length} shows)
              </span>
              {isLoadingTv && (
                <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin ml-1" />
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'trending' as const, label: '🔥 Trending Series' },
                { id: 'popular' as const, label: '⭐ Popular Shows' },
                { id: 'top_rated' as const, label: '🏆 Top Rated TV' },
              ].map((cat) => {
                const isActive = tvCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setTvCategory(cat.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                      isActive
                        ? 'bg-purple-500 text-black font-bold shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

            {/* Quick Filter Bar & Section Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  {currentTab === 'watchlist' ? (
                    <>
                      <Bookmark className="w-5 h-5 text-amber-400" />
                      <span>My Watchlist</span>
                      <span className="text-xs font-mono text-slate-500 font-normal">({filteredCatalog.length} saved)</span>
                    </>
                  ) : sourceFilter !== 'all' ? (
                    <>
                      <Tv className="w-5 h-5 text-amber-400" />
                      <span>{SOURCE_METADATA[sourceFilter]?.name || 'Streaming Servers'}</span>
                      <span className="text-xs font-mono text-slate-500 font-normal">({filteredCatalog.length} streams)</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 text-amber-400" />
                      <span>Featured Multi-Source Streams</span>
                      <span className="text-xs font-mono text-slate-500 font-normal">({filteredCatalog.length} releases)</span>
                    </>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Native playback across Ultra 4K UHD, South Asian cinema, FastStream edge nodes, and Cloud Vault mirrors.
                </p>
              </div>

              {/* Source Filter Segmented Buttons */}
              <SourceFilterBar
                selectedSource={sourceFilter}
                onSelectSource={(s) => setSourceFilter(s)}
                counts={sourceCounts}
              />
            </div>

            {/* Empty State */}
            {filteredCatalog.length === 0 ? (
              <div className="py-20 text-center rounded-2xl bg-slate-900/40 border border-slate-800">
                <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-bold text-white">No streams found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  {searchQuery
                    ? `No releases match "${searchQuery}". Try searching by actor, director, or hub name.`
                    : 'No items in this category yet.'}
                </p>
              </div>
            ) : (
              /* Movie Grid (Responsive from mobile 2-col to desktop 4-5 col) */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4 md:gap-6">
                {filteredCatalog.map((media) => (
                  <MovieCard
                    key={media.id}
                    media={media}
                    onPlay={(m) => handlePlayMedia(m)}
                    onOpenDetails={(m) => setDetailMedia(m)}
                    isBookmarked={watchlistIds.includes(media.id)}
                    onToggleBookmark={toggleBookmark}
                  />
                ))}
              </div>
            )}

            {tabCanLoadMore && liveFeedReady && (
              <div ref={loadMoreRef} className="py-8 text-center" aria-live="polite">
                {loadingMore && <p className="text-sm text-slate-300">Loading more {currentTab === 'movies' ? 'movies' : 'series'}…</p>}
                {loadMoreError && <button type="button" onClick={() => { setLoadMoreError(''); loadingNextRef.current = false; }} className="px-4 py-2 rounded-lg bg-slate-800 text-amber-300">Retry loading more</button>}
                {!loadingMore && !loadMoreError && !isMoreAvailable && <p className="text-xs text-slate-500">You've reached the end of available titles.</p>}
              </div>
            )}

            {/* Live TMDB Global Search Results */}
            {searchQuery.trim() && (
              <div className="mt-8 pt-6 border-t border-slate-800">
                {searchLoading && <p role="status" className="text-sm text-slate-300">Searching movies and series…</p>}
                {searchError && <p role="alert" className="text-sm text-amber-300">{searchError}</p>}
                {!searchLoading && !searchError && tmdbSearchResults.length === 0 && <p className="text-sm text-slate-400">No matching movies or series found in TMDB.</p>}
              </div>
            )}
            {searchQuery && tmdbSearchResults.length > 0 && (
              <div className="mt-8 pt-6 border-t border-slate-800">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#01b4e4]/20 text-[#01b4e4] border border-[#01b4e4]/30 uppercase">
                    TMDB
                  </span>
                  <h3 className="text-base font-bold text-white">
                    Movie & Series Search Results ({tmdbSearchResults.length})
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4 md:gap-6">
                  {tmdbSearchResults.map((m) => (
                    <MovieCard
                      key={m.id}
                      media={m}
                      onPlay={(item) => handlePlayMedia(item)}
                      onOpenDetails={(item) => setDetailMedia(item)}
                      isBookmarked={watchlistIds.includes(m.id)}
                      onToggleBookmark={toggleBookmark}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Source Network Feature Highlights (When viewing Browse home) */}
            {currentTab === 'browse' && sourceFilter === 'all' && !searchQuery && (
              <section className="mt-14 pt-10 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Layers className="w-5 h-5 text-amber-400" />
                      Supported Stream Protocol Integration
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Unified streaming engine supporting multi-server failover and high-bitrate mirrors
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  {/* Ultra 4K */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-400 text-sm">Ultra 4K & HDR Cinema</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300">4K UHD</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      True 2160p HEVC 10-bit prints, Dolby Atmos surround tracks, and Dual Audio Hindi & English stems.
                    </p>
                    <div className="pt-2 flex items-center gap-1.5 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>HDR10 & HEVC Hardware Accelerated</span>
                    </div>
                  </div>

                  {/* South Asian Cinema */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-pink-400 text-sm">South Asian Cinema</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-300">REGIONAL</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Premier South Asian cinema destination. Official master prints for Tamil, Telugu, Hindi, and Malayalam.
                    </p>
                    <div className="pt-2 flex items-center gap-1.5 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Original Audio & Embedded Subtitles</span>
                    </div>
                  </div>

                  {/* FastStream Edge */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 text-sm">FastStream Edge CDN</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">LOW LATENCY</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Direct edge CDN streaming nodes. Zero buffering with instant adaptive bitrate hopping and sub-second seeking.
                    </p>
                    <div className="pt-2 flex items-center gap-1.5 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Sub-Second Seeking & 60FPS</span>
                    </div>
                  </div>

                  {/* PixelDrain Cloud Vault */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-400 text-sm">Cloud Vault Direct</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300">CLOUD VAULT</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Direct cloud streaming via high-speed API. Direct MP4 stream piping with resumable download generation.
                    </p>
                    <div className="pt-2 flex items-center gap-1.5 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Resume Stream & Direct Downloads</span>
                    </div>
                  </div>
                </div>
              </section>
            )}
      </main>

      {/* Footer (Anti-Slop compliant, quiet links & copyright) */}
      <footer className="border-t border-slate-800/80 bg-[#06080c] py-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">FlixLeo</span>
            <span aria-hidden="true">·</span>
            <span>Mobile & Desktop Multi-Source Cinema Engine</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Ultra 4K UHD</span>
            <span aria-hidden="true">·</span>
            <span>Cinema Master</span>
            <span aria-hidden="true">·</span>
            <span>FastStream Edge</span>
            <span aria-hidden="true">·</span>
            <span>Cloud Vault</span>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation (Ergonomic thumb zone) */}
      <MobileBottomNav
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        bookmarkCount={watchlistIds.length}
      />

      {/* Media Detail & Mirror Selector Modal */}
      <MediaDetailModal
        media={detailMedia}
        isOpen={Boolean(detailMedia)}
        onClose={() => setDetailMedia(null)}
        onPlayMedia={handlePlayMedia}
        isBookmarked={detailMedia ? watchlistIds.includes(detailMedia.id) : false}
        onToggleBookmark={toggleBookmark}
      />

    </div>
  );
}