import React, { useState, useEffect, useMemo } from 'react';
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
          setTmdbMovies(Array.from(unique.values()));
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
          setTvShows(d.items);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingTv(false));
  }, [tvCategory]);

  // Active Playback State
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [activeMirrorId, setActiveMirrorId] = useState<string | undefined>(undefined);

  // Modals
  const [detailMedia, setDetailMedia] = useState<MediaItem | null>(null);

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
        setTmdbSearchResults(Array.from(unique.values()));
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
      list = tmdbMovies.length > 0 ? tmdbMovies : catalog;
    }

    // When on Series tab
    if (currentTab === 'series') {
      const manualSeries = catalog.filter(m => m.id.startsWith('tv-') || m.type === 'tv');
      list = [...tvShows, ...manualSeries];
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

    return list;
  }, [catalog, currentTab, tmdbCategory, tmdbMovies, tvShows, sourceFilter, searchQuery, watchlistIds]);

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
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-12">
        {/* Active Cinema Video Player (if active) */}
        {activeMedia && (
          <div className="mb-10 animate-fade-in relative z-30">
            <CinemaPlayer
              media={activeMedia}
              initialMirrorId={activeMirrorId}
              onClose={() => setActiveMedia(null)}
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