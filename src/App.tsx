import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Film, Search, Sparkles, Bookmark, Link as LinkIcon,
  Play, RefreshCw, Layers, CheckCircle2, Tv
} from 'lucide-react';
import { MediaItem, SourceType, StreamMirror } from './types/stream';
import { MEDIA_CATALOG, SOURCE_METADATA } from './data/mockCatalog';
import { Navbar } from './components/Header/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { CinemaPlayer } from './components/Player/CinemaPlayer';
import { HeroBanner } from './components/Catalog/HeroBanner';
import { MobileHomeCollections } from './components/Catalog/MobileHomeCollections';
import { PlavioLiveSection } from './components/Catalog/PlavioLiveSection';
import { MovieCard } from './components/Catalog/MovieCard';
import { PosterOptions } from './components/Catalog/PosterOptions';
import { SourceFilterBar } from './components/Catalog/SourceFilterBar';
import { MediaDetailModal } from './components/Catalog/MediaDetailModal';
import { TvSignIn, TvPairApproval } from './components/TvPairing';
import { TvExperience } from './components/TvExperience';
import { TvTitleCard } from './components/TvTitleCard';
import { cloudListApprovedTvs, cloudRevokeTv, cloudCheckTv, type ApprovedTv } from './lib/cloudSync';
import { cloudConfigured, currentCloudUser, cloudSignIn, cloudSignUp, cloudResendVerification, cloudSignOut, cloudUpdateProfile, cloudChangePassword, cloudResetPassword, cloudRecoveryTokenFromUrl, cloudCompleteRecovery, cloudRead, cloudWrite, mergeCloudData, type CloudUser, type CloudRecord } from './lib/cloudSync';

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

const LANGUAGE_OPTIONS = ['English', 'Tamil', 'Sinhala', 'Hindi', 'Telugu', 'Malayalam', 'Kannada', 'Korean', 'Japanese'];
const GENRE_OPTIONS = ['Action', 'Comedy', 'Drama', 'Romance', 'Thriller', 'Horror', 'Sci-Fi', 'Adventure', 'Crime', 'Fantasy', 'Animation', 'Mystery'];
const ARTIST_OPTIONS = ['Vijay', 'Ajith Kumar', 'Rajinikanth', 'Suriya', 'Dhanush', 'Shah Rukh Khan', 'Allu Arjun', 'Prabhas', 'Mahesh Babu', 'Nayanthara', 'Samantha Ruth Prabhu', 'Leonardo DiCaprio', 'Tom Cruise', 'Keanu Reeves', 'Zendaya'];
function languageMatches(actual: string, preference: string) {
  const lookup: Record<string, string> = { English: 'en', Tamil: 'ta', Sinhala: 'si', Hindi: 'hi', Telugu: 'te', Malayalam: 'ml', Kannada: 'kn', Korean: 'ko', Japanese: 'ja' };
  return actual.toLowerCase() === preference.toLowerCase() || actual.toLowerCase() === lookup[preference];
}
export default function App() {
  // Native Android is a separate WebView app; preserve its existing home layout.
  const isNativeAndroid = /FlixLeoNative\/[0-9]/i.test(navigator.userAgent);
  const isWindowsExe = Boolean((window as Window & { flixleoDesktop?: unknown }).flixleoDesktop);
  const [isTvDisplay] = useState(() => window.location.pathname.toLowerCase().replace(/\/$/, '') === '/tv6' || /smart-tv|smarttv|hbbtv|netcast|web0s|webos|tizen|android tv|googletv|aft[a-z]|bravia|viera|roku|vidaa/i.test(navigator.userAgent));
  // Catalog State
  const [catalog, setCatalog] = useState<MediaItem[]>(MEDIA_CATALOG);
  const [currentTab, setCurrentTab] = useState<string>('browse');
  const [sourceFilter, setSourceFilter] = useState<SourceType | 'all'>('all');
  const [tmdbCategory, setTmdbCategory] = useState<'trending' | 'popular' | 'top_rated' | 'indian' | 'all'>('trending');
  const [tmdbMovies, setTmdbMovies] = useState<MediaItem[]>([]);
  const [homeCollections, setHomeCollections] = useState<Record<string, MediaItem[]>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tmdb/home-collections', { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Catalogue request failed')))
      .then(result => {
        if (result?.success && result.collections && typeof result.collections === 'object') {
          setHomeCollections(result.collections);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);


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
  const [minimizeSignal, setMinimizeSignal] = useState(0);
  // Each play action begins in the main video surface, including a new mirror of the same title.
  const [playSession, setPlaySession] = useState(0);
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
  const liveFeedReady = currentTab === 'series' ? tvShows.length > 0 : tmdbMovies.length > 0;

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
    const checkBottom = () => {
      if (loadingNextRef.current || !node.isConnected) return;
      if (node.getBoundingClientRect().top <= window.innerHeight + 650) {
        loadingNextRef.current = true;
        setLoadingMore(true);
      }
    };
    window.addEventListener('scroll', checkBottom, { passive: true });
    window.addEventListener('resize', checkBottom);
    checkBottom();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', checkBottom);
      window.removeEventListener('resize', checkBottom);
    };
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
  const [recentPlayed, setRecentPlayed] = useState<MediaItem[]>([]);
  const [continueWatching, setContinueWatching] = useState<{ media: MediaItem; mirrorId?: string; progress: number; duration: number; updatedAt: number }[]>([]);
  const refreshContinueWatching = React.useCallback(() => {
    try {
      const entries = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      if (Array.isArray(entries)) {
        setRecentPlayed(entries.filter(entry => entry?.media?.id).slice(0, 20).map(entry => entry.media));
        setContinueWatching(entries.filter(entry => entry?.media?.id && (!entry.duration || entry.progress / entry.duration < 0.95)).slice(0, 12));
      }
    } catch { setContinueWatching([]); }
  }, []);
  useEffect(() => { refreshContinueWatching(); }, [refreshContinueWatching]);

  // Watchlist persisted in localStorage
  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cinehub_watchlist');
      const ids = saved ? JSON.parse(saved) : [];
      return Array.isArray(ids) ? ids.filter((id: unknown) => typeof id === 'string' && !['stream-overdrive-4k', 'stream-rajputana-warrior'].includes(id)) : [];
    } catch {
      return [];
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
  const [accountSection, setAccountSection] = useState<'overview' | 'profile' | 'security' | 'appearance'>('overview');
  const [approvedTvs, setApprovedTvs] = useState<ApprovedTv[]>([]);
  const [showTvHelp, setShowTvHelp] = useState(false);
  const [tvListError, setTvListError] = useState('');
  const [tvListBusy, setTvListBusy] = useState(false);
  const refreshTvs = async () => {
    setTvListBusy(true); setTvListError('');
    try { setApprovedTvs(await cloudListApprovedTvs()); }
    catch (e) { setTvListError(e instanceof Error ? e.message : 'Could not load approved TVs'); }
    finally { setTvListBusy(false); }
  };
  useEffect(() => {
    if (accountOpen && cloudUser && accountSection === 'security') void refreshTvs();
  }, [accountOpen, cloudUser?.id, accountSection]);
  useEffect(() => {
    if (!isTvDisplay || !cloudUser) return;
    const id = localStorage.getItem('flixleo_tv_device_id');
    if (!id) return;
    let busy = false;
    const verify = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!await cloudCheckTv(id)) {
          localStorage.removeItem('flixleo_tv_device_id');
          await cloudSignOut();
          setCloudUser(null); setCloudReady(false); setAccountOpen(true);
          setTvSignInMode(true);
        }
      } catch { /* preserve login during temporary outages; retry on next check */ }
      finally { busy = false; }
    };
    void verify();
    const timer = window.setInterval(verify, 30000);
    return () => window.clearInterval(timer);
  }, [isTvDisplay, cloudUser?.id]);
  const [tvSignInMode, setTvSignInMode] = useState(() =>
    window.location.pathname.toLowerCase().replace(/\/$/, '') === '/tv6' ||
    new URLSearchParams(window.location.search).get('tv') === '1' ||
    /smart-tv|smarttv|hbbtv|netcast|web0s|webos|tizen|android tv|googletv|aft[a-z]|bravia|viera|roku|vidaa/i.test(navigator.userAgent));
  const [phonePairId, setPhonePairId] = useState(() => new URLSearchParams(window.location.search).get('tv_pair') || '');
  useEffect(() => {
    if (phonePairId || window.location.pathname.toLowerCase().replace(/\/$/, '') === '/tv6' || new URLSearchParams(window.location.search).get('tv') === '1') setAccountOpen(true);
  }, [phonePairId]);
  const completeTvPair = () => {
    setPhonePairId('');
    const params = new URLSearchParams(window.location.search);
    params.delete('tv_pair');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash);
    setAccountOpen(false);
  };
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryDone, setRecoveryDone] = useState(false);
  useEffect(() => {
    if (!window.location.hash.includes('type=recovery') && !new URLSearchParams(window.location.search).get('token_hash')) return;
    cloudRecoveryTokenFromUrl().then(token => {
      if (token) { setRecoveryToken(token); setAccountOpen(false); }
    }).catch(err => {
      setRecoveryError(err instanceof Error ? err.message : 'Recovery link expired. Request a new one.');
      window.history.replaceState({}, '', window.location.pathname);
    });
  }, []);

  const [accountEmail, setAccountEmail] = useState('');
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [favoriteLanguages, setFavoriteLanguages] = useState<string[]>(() => currentCloudUser()?.user_metadata?.favorite_languages || []);
  const [favoriteGenres, setFavoriteGenres] = useState<string[]>(() => currentCloudUser()?.user_metadata?.favorite_genres || []);
  const [favoriteArtists, setFavoriteArtists] = useState<string[]>(() => currentCloudUser()?.user_metadata?.favorite_artists || []);
  const togglePreference = (value: string, selected: string[], update: (next: string[]) => void) => update(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  const savePreferences = async () => {
    setAccountBusy(true); setAccountNotice('');
    try {
      const user = await cloudUpdateProfile({ favorite_languages: favoriteLanguages, favorite_genres: favoriteGenres, favorite_artists: favoriteArtists });
      setCloudUser(user); setOnboardingOpen(false); setAccountSection('overview');
      setAccountNotice('Your For You catalog is personalized.');
    } catch (error) { setAccountNotice(error instanceof Error ? error.message : 'Could not save preferences.'); }
    finally { setAccountBusy(false); }
  };
  const [accountPassword, setAccountPassword] = useState('');
  const [signupAgreed, setSignupAgreed] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountNotice, setAccountNotice] = useState('');

  const [profileAccent, setProfileAccent] = useState(() => { try { return localStorage.getItem('flixleo_profile_accent') || '#f59e0b'; } catch { return '#f59e0b'; } });
  const [profileName, setProfileName] = useState(() => currentCloudUser()?.user_metadata?.display_name || '');
  const [preferredLanguage, setPreferredLanguage] = useState(() => currentCloudUser()?.user_metadata?.preferred_language || 'all');
  const [newPassword, setNewPassword] = useState('');
  const [showAccountHistory, setShowAccountHistory] = useState(false);
  const accountAction = async (action: () => Promise<unknown>, success: string) => {
    setAccountBusy(true); setAccountNotice('');
    try { await action(); setAccountNotice(success); }
    catch (error) { setAccountNotice(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setAccountBusy(false); }
  };
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
  }, [cloudUser, cloudReady, watchlistIds, continueWatching, recentPlayed, makeLocalSnapshot]);
  const submitAccount = async (mode: 'signin' | 'signup') => {
    setAccountBusy(true);
    setAccountNotice('');
    try {
      if (mode === 'signup') {
        if (!signupAgreed) throw new Error('Please read and accept the Terms and Privacy Policy to create an account.');
        const active = await cloudSignUp(accountEmail.trim(), accountPassword);
        if (!active) { setAuthTab('signin'); setAccountNotice('Account created. Check your email for verification, then sign in.'); return; }
      } else { await cloudSignIn(accountEmail.trim(), accountPassword); }
      setCloudReady(false);
      setCloudUser(currentCloudUser());
      setProfileName(currentCloudUser()?.user_metadata?.display_name || '');
      setPreferredLanguage(currentCloudUser()?.user_metadata?.preferred_language || 'all');
      const metadata = currentCloudUser()?.user_metadata;
      setFavoriteLanguages(metadata?.favorite_languages || []);
      setFavoriteGenres(metadata?.favorite_genres || []);
      setFavoriteArtists(metadata?.favorite_artists || []);
      setOnboardingOpen(!(metadata?.favorite_languages?.length || metadata?.favorite_genres?.length || metadata?.favorite_artists?.length));
      setAccountSection('overview');
      setAccountPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      if (mode === 'signup' && /already registered|already exists|user already/i.test(message)) {
        setAuthTab('signin');
        setAccountNotice('This email already has an account. Please sign in.');
      } else if (mode === 'signin' && /invalid login credentials|user not found/i.test(message)) {
        setAccountNotice('Email or password is incorrect. If you are new, choose Create account.');
      } else setAccountNotice(message);
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
        const responses = await Promise.allSettled(endpoints.map(async endpoint => {
          const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (!response.ok) throw new Error('Search service unavailable');
          const payload = await response.json();
          if (!payload?.success || !Array.isArray(payload.items)) throw new Error('Search service unavailable');
          return { items: payload.items as MediaItem[], live: payload.isLive === true };
        }));
        if (controller.signal.aborted) return;
        const good = responses.filter((r): r is PromiseFulfilledResult<{ items: MediaItem[]; live: boolean }> => r.status === 'fulfilled');
        const localMatches = [...catalog, ...tmdbMovies, ...tvShows, ...movieExtra, ...tvExtra].filter(m =>
          [m.title, m.originalTitle || '', ...(m.cast || [])].some(v => v.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
        );
        const all = uniqueTitles([...good.flatMap(r => r.value.items), ...localMatches]);
        setTmdbSearchResults(all);
        if (good.length === 0) {
          setSearchError('Live search is temporarily unavailable. Showing any matching titles already loaded.');
        } else if (!good.some(r => r.value.live)) {
          setSearchError('Live TMDB search is not connected. Showing matching titles from the available catalogue.');
        } else if (good.length < endpoints.length) {
          setSearchError('Some search sources are unavailable. Showing available results.');
        }

      } catch (error) {
        if (!controller.signal.aborted) setSearchError('Live search is unavailable. Check the TMDB connection and try again.');
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchQuery, catalog, tmdbMovies, tvShows, movieExtra, tvExtra]);

  // Toggle Bookmark
  const toggleBookmark = (media: MediaItem) => {
    if (!currentCloudUser()) {
      setAuthTab('signin');
      setAccountNotice('Sign in or create a free account to add movies to your watchlist.');
      setAccountOpen(true);
      return;
    }
    setWatchlistIds(prev =>
      prev.includes(media.id) ? prev.filter(id => id !== media.id) : [...prev, media.id]
    );
  };

  // Switch tabs
  const handleSelectTab = (tab: string) => {
    if (tab !== 'search' && searchQuery) setSearchQuery('');
    if (activeMedia) setMinimizeSignal(n => n + 1);
    if (['streamhub', 'vault', 'remux', 'fastedge'].includes(tab)) {
      setCurrentTab('browse');
      setSourceFilter(tab as SourceType);
    } else if (tab === 'browse' || tab === 'hubs') {
      setCurrentTab('browse');
      setSourceFilter('all');
    } else {
      setCurrentTab(tab);
      // Server filters must not hide titles on Watchlist, Search or other tabs.
      setSourceFilter('all');
    }
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // For You learns from each opened movie or episode, including embedded players.
  // Keep prior resume progress rather than overwriting it with zero.
  const progressKey = (m: MediaItem) => m.id + (m.playbackSeason !== undefined && m.playbackEpisode !== undefined ? ':s' + m.playbackSeason + 'e' + m.playbackEpisode : '');
  const rememberPlayed = (media: MediaItem) => {
    try {
      const saved = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      const entries = Array.isArray(saved) ? saved : [];
      const previous = entries.find(entry => entry?.media && progressKey(entry.media) === progressKey(media));
      const updated = [
        { media, mirrorId: previous?.mirrorId, progress: previous?.progress || 0, duration: previous?.duration || 0, updatedAt: Date.now() },
        ...entries.filter(entry => entry?.media && progressKey(entry.media) !== progressKey(media))
      ].slice(0, 20);
      localStorage.setItem('flixleo_continue_watching', JSON.stringify(updated));
      refreshContinueWatching();
    } catch { /* browsing still works without persistent storage */ }
  };

  const playNextEpisode = async () => {
    const current = activeMedia;
    if (!current || current.playbackSeason === undefined || current.playbackEpisode === undefined) return;
    const tmdb = current.id.match(/^(?:tmdb-|tv-)(\d+)$/)?.[1];
    if (!tmdb) return;
    try {
      const details = current.seasons?.length ? current : await fetch('/api/tmdb/details/tv/' + current.id).then(r => r.json()).then(data => data.item as MediaItem);
      const episodes = (details?.seasons || []).flatMap(season => season.episodes.map(episode => ({ season: season.number, episode: episode.number })))
        .filter(ep => ep.season > 0 && (ep.season > current.playbackSeason! || (ep.season === current.playbackSeason && ep.episode > current.playbackEpisode!)))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
      const next = episodes[0];
      if (!next) return;
      const params = new URLSearchParams({ type: 'series', tmdb, season: String(next.season), episode: String(next.episode) });
      const response = await fetch('/api/stremio/streams?' + params);
      if (!response.ok) return;
      const data = await response.json();
      const streams = (Array.isArray(data.streams) ? data.streams : []).filter((stream: any) => typeof stream.url === 'string' && /^https:\/\//.test(stream.url));
      if (!streams.length) return;
      const mirrors: StreamMirror[] = streams.map((stream: any, index: number) => ({
        id: 'stremio-' + index, source: 'custom', label: String(stream.title || stream.name || 'Stremio Stream').replace(/https?:\/\/\S+/g, '').slice(0, 100),
        quality: stream.quality === '4K' ? '4K UHD' : ['1080p','720p','480p','360p'].includes(stream.quality) ? stream.quality : 'Auto',
        url: stream.url, audioFixUrl: stream.audioFixUrl, fileSize: stream.fileSize,
        streamType: stream.streamType === 'hls' ? 'hls' : 'direct-video', isDirect: true
      }));
      const nextMedia = { ...current, seasons: details.seasons, mirrors, playbackSeason: next.season, playbackEpisode: next.episode };
      window.scrollTo(0, 0);
      setMinimizeSignal(0);
      setPlaySession(n => n + 1);
      setActiveMedia(nextMedia);
      setActiveMirrorId(mirrors[0].id);
      rememberPlayed(nextMedia);
    } catch { /* Retain finished episode when the next stream is unavailable. */ }
  };

  // Launch Player
  const handlePlayMedia = (media: MediaItem, mirrorId?: string) => {
    // Scroll synchronously before mounting the player: the old smooth scroll
    // activated auto-docking while the page was moving up from a deep catalog.
    window.scrollTo(0, 0);
    setMinimizeSignal(0);
    setPlaySession(n => n + 1);
    rememberPlayed(media);
    setActiveMedia(media);
    let savedMirrorId: string | undefined;
    if (!mirrorId) {
      try {
        const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
        const entry = Array.isArray(rows) ? rows.find((row: any) => row?.media && progressKey(row.media) === progressKey(media)) : undefined;
        if (entry?.mirrorId && media.mirrors.some(m => m.id === entry.mirrorId)) savedMirrorId = entry.mirrorId;
      } catch { /* use first available server */ }
    }
    setActiveMirrorId(mirrorId || savedMirrorId || media.mirrors[0]?.id);
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

  // Saved titles can come from dynamically fetched TMDB movies and series, not only the curated catalog.
  const [savedTitleDetails, setSavedTitleDetails] = useState<MediaItem[]>([]);
  useEffect(() => {
    const loaded = new Set([...catalog, ...tmdbMovies, ...movieExtra, ...tvShows, ...tvExtra, ...savedTitleDetails].map(m => m.id));
    const missing = watchlistIds.filter(id => !loaded.has(id) && /^(?:tmdb-|tv-)?[0-9]+$/.test(id));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async id => {
      const isTv = id.startsWith('tv-');
      try {
        const response = await fetch('/api/tmdb/' + (isTv ? 'tv/' : 'movie/') + encodeURIComponent(id.replace(/^(tmdb-|tv-)/, '')));
        const result = await response.json();
        return result?.item as MediaItem | undefined;
      } catch { return undefined; }
    })).then(items => {
      if (cancelled) return;
      setSavedTitleDetails(prev => {
        const existing = new Set(prev.map(m => m.id));
        return [...prev, ...items.filter((m): m is MediaItem => Boolean(m?.id) && !existing.has(m!.id))];
      });
    });
    return () => { cancelled = true; };
  }, [watchlistIds, catalog, tmdbMovies, movieExtra, tvShows, tvExtra, savedTitleDetails]);

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
      list = [...catalog, ...tmdbMovies, ...movieExtra, ...tvShows, ...tvExtra, ...savedTitleDetails].filter(m => watchlistIds.includes(m.id));
    }

    // Search all locally loaded catalogues and both live TMDB search endpoints.
    // Never restrict global search to the current tab, watchlist, or source filter.
    if (searchQuery.trim()) {
      const q = searchQuery.toLocaleLowerCase().trim();
      const local = [...catalog, ...tmdbMovies, ...movieExtra, ...tvShows, ...tvExtra].filter(m =>
        [m.title, m.originalTitle || '', m.language || '', ...(m.genres || []), ...(m.cast || [])]
          .some(v => v.toLocaleLowerCase().includes(q))
      );
      list = uniqueTitles([...tmdbSearchResults, ...local]);
    } else if (sourceFilter !== 'all' && currentTab === 'browse') {
      // Only the legacy Browse source view uses this filter; never hide saved titles.
      list = list.filter(m => m.availableSources.includes(sourceFilter));
    }

    return uniqueTitles(list);
  }, [catalog, currentTab, tmdbCategory, tmdbMovies, tvShows, movieExtra, tvExtra, sourceFilter, searchQuery, watchlistIds, tmdbSearchResults, savedTitleDetails]);

  // Personalize using explicit favorites and recent viewing without changing playback.
  const forYouTitles = useMemo(() => {
    const candidates = uniqueTitles([...tmdbMovies, ...tvShows, ...movieExtra, ...tvExtra, ...catalog]);
    const watchedIds = new Set(recentPlayed.map(media => media.id));
    const history = recentPlayed.slice(0, 12);
    return candidates.filter(media => !watchedIds.has(media.id)).map(media => {
      const languageScore = favoriteLanguages.some(lang => languageMatches(String(media.language || ''), lang)) ? 35 : 0;
      const genreScore = (media.genres || []).filter(genre => favoriteGenres.some(favorite => favorite.toLowerCase() === genre.toLowerCase())).length * 20;
      const artistScore = (media.cast || []).filter(actor => favoriteArtists.some(favorite => actor.toLowerCase().includes(favorite.toLowerCase()))).length * 25;
      const historyScore = history.reduce((sum, watched, index) => {
        const recency = Math.max(1, 12 - index);
        const sameLanguage = media.language && watched.language && media.language.toLowerCase() === watched.language.toLowerCase() ? 4 : 0;
        const watchedGenres = new Set((watched.genres || []).map(g => g.toLowerCase()));
        return sum + recency * (sameLanguage + (media.genres || []).filter(g => watchedGenres.has(g.toLowerCase())).length * 3);
      }, 0);
      return { media, score: languageScore + genreScore + artistScore + historyScore };
    }).sort((a, b) => b.score - a.score || Number(b.media.year || 0) - Number(a.media.year || 0)).slice(0, 16).map(item => item.media);
  }, [tmdbMovies, tvShows, movieExtra, tvExtra, catalog, recentPlayed, favoriteLanguages, favoriteGenres, favoriteArtists]);

  // Open a shared FlixLeo title when the recipient visits its link.
  useEffect(() => {
    const mediaId = new URLSearchParams(window.location.search).get('media');
    if (!mediaId || detailMedia || activeMedia) return;
    const found = [...catalog, ...tmdbMovies, ...movieExtra, ...tvShows, ...tvExtra].find(item => item.id === mediaId);
    if (found) {
      setDetailMedia(found);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (!/^(?:tmdb-|tv-)?[0-9]+$/.test(mediaId)) return;
    let cancelled = false;
    const isTv = mediaId.startsWith('tv-');
    fetch('/api/tmdb/' + (isTv ? 'tv/' : 'movie/') + encodeURIComponent(mediaId.replace(/^(tmdb-|tv-)/, '')))
      .then(r => r.json()).then(data => {
        if (!cancelled && data?.item) {
          setDetailMedia(data.item as MediaItem);
          window.history.replaceState({}, '', window.location.pathname);
        }
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [catalog, tmdbMovies, movieExtra, tvShows, tvExtra, detailMedia, activeMedia]);

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

  // Interleave movies and series in the mobile Home's featured 3D wheel.
  // Other tabs and larger screens keep their existing featured content.
  const mobileWheelItems = useMemo(() => {
    const movies = tmdbMovies.filter(item => item.type !== 'tv' && !item.id.startsWith('tv-'));
    const series = tvShows.filter(item => item.type === 'tv' || item.id.startsWith('tv-'));
    const result: MediaItem[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < Math.max(movies.length, series.length) && result.length < 11; i++) {
      for (const item of [movies[i], series[i]]) {
        if (item?.posterUrl && !seen.has(item.id) && result.length < 11) {
          seen.add(item.id);
          result.push(item);
        }
      }
    }
    if (!result.length) return uniqueTitles(catalog).slice(0, 11);
    return result;
  }, [tmdbMovies, tvShows, catalog]);
  const mobileWheelFeatured = mobileWheelItems[0] || featuredMedia;
  // Reuse the mobile Home's mixed wheel for desktop web and Windows EXE.
  // Preserve the existing native Android and smart-TV layouts.
  const [isMobileHomeViewport, setIsMobileHomeViewport] = useState(() => window.innerWidth <= 640);
  useEffect(() => {
    const onResize = () => setIsMobileHomeViewport(window.innerWidth <= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const showMixedMobileWheel = !isTvDisplay && (isMobileHomeViewport || !isNativeAndroid) && currentTab === 'browse';

  return (
    <div className={`${isTvDisplay ? "flixleo-tv" : ""} min-h-screen bg-[#080a0f] text-slate-100 flex flex-col selection:bg-amber-500 selection:text-black`}>
      {isTvDisplay && <TvExperience currentTab={currentTab} onSelectTab={handleSelectTab} onOpenProfile={() => { setAccountSection('overview'); setAccountOpen(true); }} />}
      {/* Top Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedSourceFilter={sourceFilter}
        onSelectSourceFilter={setSourceFilter}
        bookmarkCount={watchlistIds.length}
        onOpenProfile={() => { setAccountSection('overview'); setAccountOpen(true); }}
      />

      {(recoveryToken || recoveryError || recoveryDone) && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <div role="dialog" aria-modal="true" aria-label="Reset FlixLeo password" className="w-full max-w-md rounded-3xl border border-white/15 bg-[#111625] p-6 shadow-2xl space-y-5">
            <div><p className="text-xs uppercase tracking-widest text-amber-400 font-bold">FlixLeo account recovery</p><h2 className="mt-2 text-2xl font-bold text-white">{recoveryDone ? 'Password changed' : 'Create new password'}</h2></div>
            {recoveryDone ? <div className="space-y-4"><p className="text-emerald-300 text-sm">Your password has been updated. You can now sign in.</p><button type="button" onClick={() => { setRecoveryDone(false); setRecoveryToken(null); setAccountOpen(true); setAuthTab('signin'); }} className="w-full rounded-xl bg-amber-500 p-3 font-semibold text-black">Go to sign in</button></div>
            : recoveryToken ? <form className="space-y-4" onSubmit={async e => {
              e.preventDefault();
              if (recoveryPassword !== recoveryConfirm) { setRecoveryError('Passwords do not match.'); return; }
              setRecoveryBusy(true); setRecoveryError('');
              try { await cloudCompleteRecovery(recoveryToken, recoveryPassword); setRecoveryToken(null); setRecoveryPassword(''); setRecoveryConfirm(''); setRecoveryDone(true); }
              catch (err) { setRecoveryError(err instanceof Error ? err.message : 'Unable to reset password.'); }
              finally { setRecoveryBusy(false); }
            }}>
              <label className="block text-sm text-slate-300">New password<input required minLength={8} autoComplete="new-password" type="password" value={recoveryPassword} onChange={e => setRecoveryPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" placeholder="At least 8 characters" /></label>
              <label className="block text-sm text-slate-300">Confirm new password<input required minLength={8} autoComplete="new-password" type="password" value={recoveryConfirm} onChange={e => setRecoveryConfirm(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" placeholder="Repeat new password" /></label>
              {recoveryError && <p role="alert" className="text-sm text-rose-300">{recoveryError}</p>}
              <button disabled={recoveryBusy} type="submit" className="w-full rounded-xl bg-amber-500 p-3 font-bold text-black disabled:opacity-50">{recoveryBusy ? 'Updating…' : 'Save new password'}</button>
            </form> : <div className="space-y-3"><p role="alert" className="text-sm text-rose-300">{recoveryError}</p><button type="button" onClick={() => { setRecoveryError(''); setAccountOpen(true); setAuthTab('signin'); }} className="w-full rounded-xl bg-amber-500 p-3 font-bold text-black">Request another reset link</button></div>}
          </div>
        </div>
      )}
      {accountOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-lg p-3 sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setAccountOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="FlixLeo account" className="tv6-account-dialog flixleo-account-dialog w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-[30px] border border-white/10 bg-[#090f1b] p-4 sm:p-7 shadow-[0_28px_110px_rgba(0,0,0,.85)]">
            <div className="flex justify-between items-start gap-4 mb-5">
              <div><p className="text-[11px] font-bold uppercase tracking-[.35em] text-slate-400 mb-1">Your space</p><h2 className="text-[clamp(1.6rem,6vw,2.4rem)] leading-tight font-black tracking-tight text-white">FlixLeo <span style={{color: profileAccent}}>Account</span></h2><p className="text-xs sm:text-sm text-slate-400 mt-2">Manage your account, preferences and devices</p></div>
              <button onClick={() => setAccountOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white" aria-label="Close account window">✕</button>
            </div>
            {!cloudConfigured ? (
              <p className="text-sm text-amber-300">Account service unavailable. Please contact support.</p>
            ) : cloudUser ? (
              <div className="space-y-4">
                {phonePairId && <TvPairApproval id={phonePairId} user={cloudUser} onComplete={completeTvPair} />}
                <div className="rounded-[24px] bg-gradient-to-br from-slate-800/90 via-[#131d30] to-[#11101a] p-4 sm:p-5 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,.09)]">
                  <div className="flex gap-3 items-center">
                    <div style={{ backgroundColor: profileAccent }} className="h-16 w-16 shrink-0 rounded-[22px] text-black font-extrabold grid place-items-center text-3xl shadow-lg">{(profileName || cloudUser.email || 'F').charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="font-bold text-lg text-white truncate">{profileName || cloudUser.email?.split('@')[0] || 'FlixLeo member'}</p>
                      <p className="text-xs text-slate-300 truncate">{cloudUser.email}</p>
                      <p className={`text-xs mt-1 ${cloudReady ? 'text-emerald-400' : 'text-amber-300'}`}>{cloudReady ? '● Cloud sync active' : '○ Cloud sync pending'}</p>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => { setOnboardingOpen(true); setAccountNotice(''); }} className="w-full flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-950/50 to-slate-900/70 px-4 py-3.5 text-left hover:border-amber-400/60"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500/15 text-xl">✦</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Personalize your experience</span><span className="block text-xs text-slate-300">Movie languages, favorite artists &amp; genres</span></span><span className="text-amber-400 text-xl" aria-hidden="true">›</span></button>
                {onboardingOpen && <div className="space-y-4 rounded-xl border border-amber-500/30 bg-slate-900 p-3">
                  <h3 className="font-semibold text-white">Make For You yours</h3>
                  <p className="text-xs text-slate-400">Tap your favorites. No typing needed. You can change them anytime.</p>
                  {([{ title: 'Languages', options: LANGUAGE_OPTIONS, selected: favoriteLanguages, setSelected: setFavoriteLanguages },
                    { title: 'Genres', options: GENRE_OPTIONS, selected: favoriteGenres, setSelected: setFavoriteGenres },
                    { title: 'Actors & artists', options: ARTIST_OPTIONS, selected: favoriteArtists, setSelected: setFavoriteArtists }]).map(group => (
                    <div key={group.title}><p className="text-xs text-slate-300 mb-2 font-semibold">{group.title}</p>
                      <div className="flex flex-wrap gap-2">{group.options.map(value => <button key={value} type="button" aria-pressed={group.selected.includes(value)}
                        onClick={() => togglePreference(value, group.selected, group.setSelected)}
                        className={`rounded-full border px-3 py-1.5 text-xs ${group.selected.includes(value) ? 'bg-amber-500 text-black border-amber-500' : 'bg-slate-800 text-slate-200 border-slate-700'}`}>{group.selected.includes(value) ? '✓ ' : '+ '}{value}</button>)}</div>
                    </div>))}
                  <button type="button" onClick={() => void savePreferences()} disabled={accountBusy} className="w-full bg-amber-500 rounded-lg text-black font-bold p-3 disabled:opacity-50">Save my For You preferences</button>
                </div>}
                <div className="grid grid-cols-4 gap-1 rounded-[22px] border border-white/10 bg-[#111b29] p-1.5">
                  <button type="button" onClick={() => setAccountSection('overview')} className={`rounded-2xl min-h-12 px-1 py-3 text-[11px] sm:text-sm transition-colors ${accountSection === 'overview' ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-black font-extrabold shadow-[0_4px_18px_rgba(245,158,11,.22)]' : 'bg-slate-800/70 text-slate-200 hover:bg-slate-700'}`}>My activity</button>
                  <button type="button" onClick={() => setAccountSection('profile')} className={`rounded-2xl min-h-12 px-1 py-3 text-[11px] sm:text-sm transition-colors ${accountSection === 'profile' ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-black font-extrabold shadow-[0_4px_18px_rgba(245,158,11,.22)]' : 'bg-slate-800/70 text-slate-200 hover:bg-slate-700'}`}>Profile</button>
                  <button type="button" onClick={() => setAccountSection('security')} className={`rounded-2xl min-h-12 px-1 py-3 text-[11px] sm:text-sm transition-colors ${accountSection === 'security' ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-black font-extrabold shadow-[0_4px_18px_rgba(245,158,11,.22)]' : 'bg-slate-800/70 text-slate-200 hover:bg-slate-700'}`}>Security</button>
                  <button type="button" onClick={() => setAccountSection('appearance')} className={`rounded-2xl min-h-12 px-1 py-3 text-[11px] sm:text-sm transition-colors ${accountSection === 'appearance' ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-black font-extrabold' : 'text-slate-300 hover:bg-white/10'}`}>Style</button>
                </div>
                {accountSection === 'appearance' && <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4"><div><h3 className="font-bold text-white">Make it yours</h3><p className="text-xs text-slate-400 mt-1">Pick your account accent. Saved on this device.</p></div><div className="flex flex-wrap gap-3">{['#f59e0b','#a855f7','#06b6d4','#22c55e','#f43f5e','#e2e8f0'].map(color => <button type="button" key={color} aria-label={`Choose ${color} accent`} aria-pressed={profileAccent === color} onClick={() => { setProfileAccent(color); try { localStorage.setItem('flixleo_profile_accent', color); } catch {} }} style={{backgroundColor:color}} className={`h-11 w-11 rounded-2xl transition-transform ${profileAccent === color ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0d111c] scale-105' : 'opacity-70 hover:opacity-100'}`}/>)}</div><button type="button" onClick={() => setAccountSection('profile')} className="w-full rounded-xl border border-white/15 bg-white/10 p-3 text-sm font-semibold text-white">Edit display name and language →</button></div>}
                {accountSection === 'overview' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setCurrentTab('watchlist'); setAccountOpen(false); }} className="text-left rounded-xl bg-slate-800 p-4 hover:bg-slate-700">
                        <div className="text-2xl font-bold text-white">{watchlistIds.length}</div><div className="text-xs text-slate-300">Saved to watchlist →</div>
                      </button>
                      <button type="button" onClick={() => { setShowAccountHistory(v => !v); }} className="text-left rounded-xl bg-slate-800 p-4 hover:bg-slate-700">
                        <div className="text-2xl font-bold text-white">{recentPlayed.length}</div><div className="text-xs text-slate-300">Recently played ↓</div>
                      </button>
                    </div>
                    {showAccountHistory && <div className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-2 space-y-1">{recentPlayed.length ? recentPlayed.map(media => <div key={media.id} className="text-sm text-slate-200 p-2 border-b border-slate-800">{media.title}</div>) : <p className="text-sm text-slate-400 p-2">Nothing watched yet.</p>}</div>}
                    <p className="text-xs text-slate-400">Your watchlist and Continue Watching are available across devices after cloud sync.</p>
                    <button type="button" onClick={() => void loadCloud()} disabled={accountBusy} className="w-full rounded-lg bg-amber-500 p-3 font-semibold text-black disabled:opacity-50">Sync my data now</button>
                  </div>
                )}
                {accountSection === 'profile' && (
                  <form className="space-y-3" onSubmit={e => { e.preventDefault(); void accountAction(async () => { const user = await cloudUpdateProfile({ display_name: profileName.trim(), preferred_language: preferredLanguage }); setCloudUser(user); }, 'Profile updated successfully.'); }}>
                    <label className="block text-sm text-slate-300">Display name<input maxLength={50} value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your name" className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white" /></label>
                    <label className="block text-sm text-slate-300">Preferred movie language<select value={preferredLanguage} onChange={e => setPreferredLanguage(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white">
                      <option value="all">All languages</option><option value="en">English</option><option value="ta">Tamil</option><option value="si">Sinhala</option><option value="hi">Hindi</option><option value="te">Telugu</option><option value="ml">Malayalam</option><option value="kn">Kannada</option>
                    </select></label>
                    <p className="text-xs text-slate-400">Your preference is saved to your account. Catalog filters remain under Movies and Series.</p>
                    <button disabled={accountBusy} className="w-full rounded-lg bg-amber-500 p-3 text-black font-bold disabled:opacity-50">Save profile</button>
                  </form>
                )}
                {accountSection === 'security' && (
                  <div className="space-y-3">
                    <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-slate-800/70 to-[#101827] p-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-2xl text-amber-400">▣</span><div><h3 className="font-bold text-lg text-white">Approved TVs</h3><p className="text-xs text-slate-400">Manage TVs connected through QR sign-in.</p></div></div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" aria-expanded={showTvHelp} aria-controls="flixleo-tv-help" onClick={() => setShowTvHelp(value => !value)} className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm font-bold text-amber-300 hover:bg-amber-500/20">? Help</button>
                          <button type="button" disabled={tvListBusy} onClick={() => void refreshTvs()} className="rounded-xl border border-white/10 bg-slate-700/80 px-3 py-2 text-xs sm:text-sm text-white hover:bg-slate-600">Refresh</button>
                        </div>
                      </div>
                      {showTvHelp && <div id="flixleo-tv-help" className="rounded-xl border border-amber-500/20 bg-slate-950/70 p-4 space-y-3 text-sm text-slate-200">
                        <h4 className="text-base font-bold text-white">How to sign in on your TV</h4>
                        <ol className="list-decimal space-y-2 pl-5">
                          <li>Open the internet browser on your Smart TV.</li>
                          <li>Enter <strong className="text-amber-300">flixleo.cyou/Tv6</strong> in the TV address bar.</li>
                          <li>Wait for the TV to display a QR sign-in code.</li>
                          <li>On your phone, sign in to FlixLeo and scan the QR code with your camera.</li>
                          <li>Tap <strong className="text-white">Approve TV sign-in</strong> on your phone. Only approve a TV you recognize.</li>
                          <li>Return to your TV. It should sign in automatically. Here in Security, tap <strong>Refresh</strong> to see your connected TV.</li>
                        </ol>
                        <a href="https://flixleo.cyou/Tv6" target="_blank" rel="noopener noreferrer" className="inline-block break-all font-bold text-amber-300 underline">TV login link: https://flixleo.cyou/Tv6</a>
                        <p className="text-slate-400">To disconnect a TV later, tap <strong className="text-rose-300">Revoke</strong> next to it. Use a new QR code to connect it again.</p>
                      </div>}
                      {tvListError && <p role="alert" className="text-rose-300 text-sm">{tvListError}</p>}
                      {!tvListBusy && !approvedTvs.length && !tvListError && <div className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-[#0c1625]/70 p-4"><span aria-hidden="true" className="text-2xl text-slate-400">▢</span><div><p className="text-sm font-semibold text-white">No approved TVs yet</p><p className="text-xs text-slate-400 mt-1">When you sign in on a TV, it will appear here.</p></div></div>}
                      {approvedTvs.map(tv => (
                        <div key={tv.id} className="rounded-xl border border-slate-700 p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-white">{tv.label}</p>
                            <p className="text-xs text-slate-400">Approved {new Date(tv.approved_at).toLocaleString()}</p>
                            <p className="text-xs text-slate-400">{tv.last_seen_at ? 'Last active ' + new Date(tv.last_seen_at).toLocaleString() : 'Not yet active'}</p>
                            {tv.revoked_at && <p className="text-xs text-rose-300">Revoked</p>}
                          </div>
                          {!tv.revoked_at && <button type="button" disabled={tvListBusy} className="rounded-lg border border-rose-500/50 px-3 py-2 font-semibold text-rose-300" onClick={async () => {
                            if (!window.confirm('Revoke this TV? It will be signed out shortly.')) return;
                            setTvListBusy(true);
                            try { await cloudRevokeTv(tv.id); await refreshTvs(); }
                            catch (e) { setTvListError(e instanceof Error ? e.message : 'Revocation failed'); }
                            finally { setTvListBusy(false); }
                          }}>Revoke</button>}
                        </div>
                      ))}
                    </div>
                    <p className="text-sm font-bold text-white">🔒 Change password <span className="block text-xs font-normal text-slate-400 mt-1">Update the password for {cloudUser.email}</span></p>
                    <form onSubmit={e => { e.preventDefault(); void accountAction(async () => { await cloudChangePassword(newPassword); setNewPassword(''); }, 'Password updated.'); }} className="space-y-2">
                      <input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (8+ characters)" className="w-full rounded-2xl bg-[#0d1627] border border-slate-600/60 p-4 text-white outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                      <button disabled={accountBusy} className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 p-4 text-black font-extrabold disabled:opacity-50 hover:brightness-110">Update password</button>
                    </form>
                    <button type="button" disabled={accountBusy} onClick={() => void accountAction(() => cloudResetPassword(cloudUser.email || ''), 'Password reset email requested. Check your inbox.')} className="w-full rounded-2xl border border-slate-600/70 bg-slate-800/40 p-4 text-left text-white hover:bg-slate-700/50">✉ &nbsp; Email password reset link</button>
                  </div>
                )}
                <button type="button" onClick={() => { void accountAction(async () => { await cloudSignOut(); setCloudUser(null); setCloudReady(false); setAccountSection('overview'); }, 'Signed out. Your cloud data remains in your account.'); }} disabled={accountBusy} className="w-full rounded-2xl border border-rose-500/50 bg-rose-950/20 py-3.5 font-semibold text-rose-300 hover:bg-rose-950/40 disabled:opacity-50">↪ &nbsp; Sign out</button>
              </div>
            ) : tvSignInMode ? (
              <TvSignIn onCancel={() => setTvSignInMode(false)} onSignedIn={user => {
                setCloudReady(false); setCloudUser(user);
                setProfileName(user.user_metadata?.display_name || '');
                setPreferredLanguage(user.user_metadata?.preferred_language || 'all');
                setFavoriteLanguages(user.user_metadata?.favorite_languages || []);
                setFavoriteGenres(user.user_metadata?.favorite_genres || []);
                setFavoriteArtists(user.user_metadata?.favorite_artists || []);
                setAccountOpen(false);
              }} />
            ) : (
              <div className="space-y-3">
                {phonePairId && <p className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-200">Sign in to your verified account, then approve connecting your TV.</p>}
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-900 p-1" role="tablist" aria-label="Account access">
                  <button type="button" role="tab" aria-selected={authTab === 'signin'} onClick={() => { setAuthTab('signin'); setAccountNotice(''); }} className={`rounded-lg p-2 font-semibold ${authTab === 'signin' ? 'bg-amber-500 text-black' : 'text-slate-300'}`}>Sign in</button>
                  <button type="button" role="tab" aria-selected={authTab === 'signup'} onClick={() => { setAuthTab('signup'); setAccountNotice(''); }} className={`rounded-lg p-2 font-semibold ${authTab === 'signup' ? 'bg-amber-500 text-black' : 'text-slate-300'}`}>Create account</button>
                </div>
                <form onSubmit={e => { e.preventDefault(); void submitAccount(authTab); }} className="space-y-3">
                  <input type="email" required autoComplete="email" placeholder="Email" value={accountEmail} onChange={e => setAccountEmail(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white" />
                  <input type="password" required minLength={authTab === 'signup' ? 8 : 1} autoComplete={authTab === 'signup' ? 'new-password' : 'current-password'} placeholder={authTab === 'signup' ? 'Create password (8+ characters)' : 'Password'} value={accountPassword} onChange={e => setAccountPassword(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-white" />
                  {authTab === 'signup' && <label className="flex gap-2 items-start text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={signupAgreed} onChange={e => setSignupAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500 shrink-0" />
                    <span>I agree to the <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-amber-300 underline">Terms &amp; Conditions</a> and <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-amber-300 underline">Privacy Policy</a>.</span>
                  </label>}
                  <button type="submit" disabled={accountBusy || (authTab === 'signup' && !signupAgreed)} className="w-full bg-amber-500 text-black font-bold rounded-lg p-3 disabled:opacity-50">{accountBusy ? 'Please wait…' : authTab === 'signin' ? 'Sign in' : 'Create account'}</button>
                </form>
                {authTab === 'signin' && <button type="button" disabled={accountBusy || !accountEmail.trim()} onClick={() => void accountAction(() => cloudResetPassword(accountEmail), 'Password reset email requested. Check your inbox.')} className="text-sm text-amber-300 hover:underline disabled:opacity-50">Forgot password?</button>}
                <button type="button" disabled={accountBusy || !accountEmail.trim()} onClick={() => void accountAction(() => cloudResendVerification(accountEmail), 'Verification email requested. Check your inbox or spam folder.')} className="block text-sm text-sky-300 hover:underline disabled:opacity-50">Resend verification</button>
              </div>
            )}
            {accountNotice && <p role="status" className="mt-4 text-sm text-amber-200">{accountNotice}</p>}
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-12">
        {/* Active Cinema Video Player (if active) */}
        {activeMedia && (
          <div className={isWindowsExe ? "mb-10 relative z-30" : "mb-10 animate-fade-in relative z-30"}>
            <CinemaPlayer
              key={activeMedia.id + ':' + (activeMedia.playbackSeason ?? '') + ':' + (activeMedia.playbackEpisode ?? '') + ':' + playSession}
              media={activeMedia}
              initialMirrorId={activeMirrorId}
              minimizeSignal={minimizeSignal}
              onClose={() => { setActiveMedia(null); refreshContinueWatching(); }}
              onProgressSaved={refreshContinueWatching}
              onEpisodeEnded={() => { void playNextEpisode(); }}
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

        {/* Shared web/Windows Home: mixed movie+series 3D wheel, then Continue Watching. */}
        {showMixedMobileWheel && sourceFilter === 'all' && !searchQuery.trim() && !activeMedia && mobileWheelFeatured && (
          <HeroBanner
            media={mobileWheelFeatured}
            items={mobileWheelItems}
            bookmarkedIds={watchlistIds}
            mobileHome
            onPlay={handlePlayMedia}
            onOpenDetails={setDetailMedia}
            isBookmarked={watchlistIds.includes(mobileWheelFeatured.id)}
            onToggleBookmark={toggleBookmark}
          />
        )}

        {currentTab === 'browse' && !searchQuery.trim() && continueWatching.length > 0 && (
          <section className="mb-8" aria-label="Continue Watching">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">Continue Watching</h2>
            </div>
            <div className={isTvDisplay ? "tv6-resume-row" : "flex gap-3 overflow-x-auto pb-3"}>
              {continueWatching.map(entry => (
                <div className="relative shrink-0">
                <button key={entry.media.id + ':s' + (entry.media.playbackSeason ?? '') + 'e' + (entry.media.playbackEpisode ?? '')} type="button"
                  onClick={() => {
                    if ((entry.media.type === 'tv' || entry.media.id.startsWith('tv-')) &&
                        (entry.media.playbackSeason === undefined || entry.media.playbackEpisode === undefined)) {
                      // Older stored series have no episode identity; never pretend the title is an episode.
                      setDetailMedia(entry.media);
                    } else {
                      handlePlayMedia(entry.media, entry.mirrorId);
                    }
                  }}
                  className={isTvDisplay ? "tv6-resume-tile" : "group text-left w-40 sm:w-48 shrink-0 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 hover:border-amber-500 focus-visible:outline-2 focus-visible:outline-amber-400"}
                  aria-label={`Resume ${entry.media.title}`}>
                  <div className="relative aspect-video bg-slate-950">
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 via-slate-950 to-black text-slate-500">
                      <span className="text-xs font-medium text-center px-3">{entry.media.title}</span>
                    </div>
                    {(entry.media.backdropUrl || entry.media.posterUrl) && <img
                      src={entry.media.backdropUrl || entry.media.posterUrl}
                      alt=""
                      loading={isTvDisplay ? 'eager' : 'lazy'}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={event => {
                        const img = event.currentTarget;
                        if (img.dataset.fallback !== 'poster' && entry.media.posterUrl && img.src !== entry.media.posterUrl) {
                          img.dataset.fallback = 'poster';
                          img.src = entry.media.posterUrl;
                        } else {
                          img.style.display = 'none';
                        }
                      }}
                    />}
                    <span className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/80 text-amber-300 text-xs font-bold">{entry.progress >= 5 ? '▶ Resume' : '▶ Continue'}</span>
                    <div className="absolute bottom-0 left-0 right-0 bg-slate-700 h-1">
                      <div className="bg-amber-500 h-full" style={{ width: `${entry.duration > 0 ? Math.min(100, Math.round(entry.progress / entry.duration * 100)) : 0}%` }} />
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-sm text-white font-medium truncate">{entry.media.title}</p>
                    {(entry.media.type === 'tv' || entry.media.id.startsWith('tv-')) && (
                      entry.media.playbackSeason !== undefined && entry.media.playbackEpisode !== undefined
                        ? <p className="text-xs font-bold text-amber-300">Season {entry.media.playbackSeason} · Episode {entry.media.playbackEpisode}</p>
                        : <p className="text-xs font-bold text-amber-300">Select season & episode</p>
                    )}
                    <p className="text-xs text-slate-400">{entry.duration > 0 && entry.progress >= 5 ? `${Math.max(0, Math.ceil((entry.duration - entry.progress) / 60))} min remaining` : entry.progress >= 5 ? `${Math.floor(entry.progress / 60)} min watched` : 'Recently opened · start playback'}</p>
                  </div>
                </button>
                {!isTvDisplay && <PosterOptions media={entry.media} onOpen={setDetailMedia} isBookmarked={watchlistIds.includes(entry.media.id)} onToggleBookmark={toggleBookmark} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {currentTab === 'browse' && !searchQuery.trim() && sourceFilter === 'all' && forYouTitles.length > 0 && (
          <section className="mb-9" aria-label="For You recommendations">
            <div className="flex justify-between items-end gap-3 mb-4">
              <div>
                <h2 className="text-xl md:text-2xl font-extrabold text-white">For You</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {recentPlayed.length
                    ? 'More movies and series matching your recently watched languages and genres'
                    : 'Discover movies and series. Your picks will personalize as you start watching.'}
                </p>
              </div>
            </div>
            <div className={isTvDisplay ? "tv6-poster-row" : "flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory"}>
              {forYouTitles.map(media => (
                <div key={media.id} className={isTvDisplay ? "tv6-poster-item" : "w-36 sm:w-44 shrink-0 snap-start"}>
                  {isTvDisplay ? <TvTitleCard media={media} onOpen={setDetailMedia} /> : <>
                  <MovieCard
                    media={media}
                    onPlay={m => setDetailMedia(m)}
                    onOpenDetails={m => setDetailMedia(m)}
                    isBookmarked={watchlistIds.includes(media.id)}
                    onToggleBookmark={toggleBookmark}
                  /></>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Search tab uses the existing global TMDB and catalog search logic. */}
        {currentTab === 'search' && (
          <div className="mb-7 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
            <label htmlFor="flixleo-global-search" className="mb-3 block text-lg font-bold text-white">Search movies &amp; series</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input id="flixleo-global-search" type="search" autoFocus
                value={searchQuery} onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search movies, series, actors..." aria-label="Search movies and TV series"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-11 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400" />
            </div>
          </div>
        )}

        {/* Spotlight Hero Banner */}
        {!showMixedMobileWheel && (['browse', 'movies', 'series'].includes(currentTab)) && sourceFilter === 'all' && !searchQuery && !activeMedia && featuredMedia && (
          <HeroBanner
            media={showMixedMobileWheel ? mobileWheelFeatured : featuredMedia}
            items={showMixedMobileWheel ? mobileWheelItems : currentTab === 'series' ? tvShows : tmdbMovies}
            bookmarkedIds={watchlistIds}
            mobileHome={false}
            onPlay={(m) => handlePlayMedia(m)}
            onOpenDetails={(m) => setDetailMedia(m)}
            isBookmarked={watchlistIds.includes((showMixedMobileWheel ? mobileWheelFeatured : featuredMedia).id)}
            onToggleBookmark={toggleBookmark}
          />
        )}

        {/* The same live catalog rows and visual pattern for web Home and the Windows EXE. */}
        {currentTab === 'browse' && !searchQuery.trim() && sourceFilter === 'all' && !activeMedia && (
          <MobileHomeCollections
            desktopView={!isTvDisplay && !isNativeAndroid}
            windowsExe={isWindowsExe}
            items={uniqueTitles([...tmdbMovies, ...tvShows, ...catalog])}
            additionalCollections={homeCollections}
            recent={continueWatching}
            onOpen={setDetailMedia}
            onPlay={handlePlayMedia}
            bookmarkedIds={watchlistIds}
            onToggleBookmark={toggleBookmark}
          />
        )}

        {/* Live TV lives only in its own navigation destination. */}
        {currentTab === 'live' && (
          <PlavioLiveSection onPlay={handlePlayMedia} />
        )}

        {currentTab !== 'live' && <div className={(!isTvDisplay && currentTab === 'browse' && !searchQuery.trim() && sourceFilter === 'all') ? (isNativeAndroid ? 'flixleo-mobile-home-hide-legacy' : 'flixleo-mobile-home-hide-legacy flixleo-web-home-hide-legacy') : ''}>
        {/* TMDB Movie Catalogs Selector */}
        {(currentTab === 'browse' || currentTab === 'movies') && !searchQuery && (
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0a101d] to-slate-950 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300 font-semibold">
                Movie Catalogs ({filteredCatalog.length} releases)
              </span>
              {isLoadingTmdb && (
                <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin ml-1" />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {[
                { id: 'trending' as const, label: '🔥 Trending Today' },
                { id: 'indian' as const, label: '🎬 South Asian / Indian Movies' },
                { id: 'popular' as const, label: '⭐ Popular Hits' },
                { id: 'top_rated' as const, label: '🏆 Top Rated' },
                { id: 'all' as const, label: '💎 All Releases' },
              ].map((cat) => {
                const isActive = tmdbCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setTmdbCategory(cat.id)}
                    className={`whitespace-nowrap shrink-0 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${cat.id === 'indian'
                      ? `px-5 py-3 text-sm sm:text-base font-extrabold rounded-xl border shadow-lg ${isActive
                          ? 'bg-gradient-to-r from-amber-300 via-orange-400 to-rose-500 text-slate-950 border-amber-200 shadow-orange-500/30 scale-[1.02]'
                          : 'bg-gradient-to-r from-orange-600/30 to-rose-600/30 text-amber-200 border-orange-500/60 hover:from-orange-500 hover:to-rose-500 hover:text-white hover:-translate-y-0.5'}`
                      : `px-3 py-2 text-xs font-semibold rounded-lg ${isActive ? 'bg-[#01b4e4] text-black font-bold shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}`}
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

            {searchQuery.trim() && (
              <div className="mb-5" aria-live="polite">
                <h2 className="text-xl font-bold text-white">Search results for “{searchQuery.trim()}”</h2>
                {searchLoading && <p className="text-sm text-slate-300 mt-2">Searching movies and series…</p>}
                {searchError && <p role="status" className="text-sm text-amber-300 mt-2">{searchError}</p>}
              </div>
            )}

            {/* Quick Filter Bar & Section Header */}
            {!searchQuery.trim() && <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
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
                      <span>{currentTab === 'movies' ? 'Explore Movies' : currentTab === 'series' ? 'Explore Series' : currentTab === 'search' ? 'Discover Titles' : 'Discover on FlixLeo'}</span>
                      <span className="text-xs font-mono text-slate-500 font-normal">({filteredCatalog.length} titles)</span>
                    </>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  {currentTab === 'watchlist'
                    ? 'Movies and series you saved for later.'
                    : currentTab === 'search'
                      ? 'Search across movies and TV series.'
                      : 'Explore movies and series. Select a title to view available playback options.'}
                </p>
              </div>

              {/* Source Filter Segmented Buttons */}
              {sourceFilter !== 'all' && currentTab === 'browse' && (
                <SourceFilterBar
                  selectedSource={sourceFilter}
                  onSelectSource={(s) => setSourceFilter(s)}
                  counts={sourceCounts}
                />
              )}
            </div>}

            {/* Saved titles are a watchlist, not a list of streaming servers. */}
            {filteredCatalog.length === 0 && !searchLoading ? (
              <div className="py-16 sm:py-20 px-5 text-center rounded-3xl bg-gradient-to-b from-slate-900/60 to-[#0b0f19] border border-white/10">
                {currentTab === 'watchlist' ? <Bookmark className="w-11 h-11 text-amber-400/70 mx-auto mb-4" /> : <Film className="w-11 h-11 text-slate-500 mx-auto mb-4" />}
                <h3 className="text-lg font-bold text-white">
                  {currentTab === 'watchlist' ? 'Your watchlist is empty' : searchQuery ? 'No matching titles' : 'No titles available'}
                </h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto mt-2">
                  {currentTab === 'watchlist'
                    ? 'Save a movie or series using the bookmark option and it will appear here.'
                    : searchQuery
                      ? `Nothing matches “${searchQuery}”. Try a different title or actor.`
                      : 'There are no titles in this section yet.'}
                </p>
                {currentTab === 'watchlist' && (
                  <button type="button" onClick={() => handleSelectTab('browse')}
                    className="mt-6 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors">
                    Browse titles
                  </button>
                )}
              </div>
            ) : (
              /* Same responsive title grid for mobile and desktop. */
              <div className={isTvDisplay ? "tv6-catalog-grid" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-5"}>
                {filteredCatalog.map((media) => isTvDisplay ? <TvTitleCard key={media.id} media={media} onOpen={setDetailMedia} /> : (
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

        </div>}
      </main>

      {/* Footer (Anti-Slop compliant, quiet links & copyright) */}
      <footer className="border-t border-slate-800/80 bg-[#06080c] py-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">FlixLeo</span>
            <span aria-hidden="true">·</span>
            <span>Movies and Series</span>
          </div>
          <div className="flex items-center gap-3 text-slate-400">
            <span>Your cinema, anywhere.</span>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation (Ergonomic thumb zone) */}
      <MobileBottomNav
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        onOpenProfile={() => { setAccountSection('overview'); setAccountOpen(true); }}
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