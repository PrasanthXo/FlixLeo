import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { StremioNativePlayer } from './StremioNativePlayer';
import { ArrowLeft, ExternalLink, RefreshCw, Share2, Maximize2, Minimize2 } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';

interface CinemaPlayerProps {
  media: MediaItem;
  initialMirrorId?: string;
  minimizeSignal?: number;
  onClose: () => void;
  onProgressSaved?: () => void;
  onEpisodeEnded?: () => void;
  onMirrorChange?: (mirror: StreamMirror) => void;
  onPlayNext?: () => void;
  hasPlayNext?: boolean;
}

export const CinemaPlayer: React.FC<CinemaPlayerProps> = ({
  media, initialMirrorId, minimizeSignal = 0, onClose, onProgressSaved, onMirrorChange, onEpisodeEnded
}) => {
  const playerAnchorRef = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  // Older saved catalogue entries can still contain the defunct embed.su mirror.
  const mirrors = (media.mirrors || []).filter(m => !/^https?:\/\/embed\.su(?:\/|$)/i.test(m.url));
  const [index, setIndex] = useState(() => Math.max(0, mirrors.findIndex(m => m.id === initialMirrorId)));
  const [tried, setTried] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<{ level: number; height: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaveRef = useRef(0);
  const active = mirrors[index];
  useEffect(() => {
    const anchor = playerAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const above = entry.boundingClientRect.bottom < 0;
      setDocked(!entry.isIntersecting && above);
    }, { threshold: 0 });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (minimizeSignal > 0) setDocked(true); }, [minimizeSignal]);
  const shareMovie = async () => {
    const tmdbMatch = media.id.match(/^(?:tmdb-|tv-)([0-9]+)$/);
    const link = tmdbMatch
      ? new URL(`https://www.themoviedb.org/${media.type === 'tv' || media.id.startsWith('tv-') ? 'tv' : 'movie'}/${tmdbMatch[1]}`)
      : new URL(window.location.origin);
    if (!tmdbMatch) link.searchParams.set('media', media.id);
    try {
      if (navigator.share) await navigator.share({ title: media.title + ' · FlixLeo', url: link.toString() });
      else { await navigator.clipboard.writeText(link.toString()); window.alert('Movie link copied'); }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') window.alert('Unable to share movie link');
    }
  };

  const autoAdvance = useCallback(() => {
    setIndex(current => {
      const attempted = new Set([...tried, current]);
      const next = mirrors.findIndex((_, i) => !attempted.has(i));
      setTried([...attempted]);
      if (next < 0) {
        setError('No working server could be confirmed. Select a server below to retry.');
        return current;
      }
      setError('Current server failed. Trying another available server…');
      return next;
    });
  }, [mirrors, tried]);

  const switchServer = (next: number) => {
    if (!mirrors[next]) return;
    setTried([]);
    setError('');
    setReady(false);
    setIndex(next);
  };

  useEffect(() => {
    setReady(false);
    setQualityLevels([]);
    setSelectedQuality(-1);
    if (!active) return;
    onMirrorChange?.(active);
    if (active.streamType === 'embed-iframe') {
      setReady(true);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    const timeout = window.setTimeout(() => {
      if (!disposed && video.readyState < 2) autoAdvance();
    }, 16000);
    const videoFailure = () => { if (!disposed) autoAdvance(); };
    const working = () => { setReady(true); setError(''); };
    video.addEventListener('error', videoFailure);
    video.addEventListener('playing', working);
    video.addEventListener('loadeddata', working);
    const url = active.url;
    if (active.streamType === 'hls' || /\.m3u8(?:\?|$)/i.test(url)) {
      if (typeof (window as any).ManagedMediaSource !== 'undefined' && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 20, maxMaxBufferLength: 45, backBufferLength: 20, startFragPrefetch: true });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setQualityLevels(hls.levels.map((level, i) => ({ level: i, height: level.height })).filter(level => level.height > 0).sort((a, b) => b.height - a.height));
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !disposed) videoFailure();
        });
      } else {
        videoFailure();
      }
    } else {
      video.src = url;
    }
    video.play().catch(() => { /* native play button remains available */ });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      video.removeEventListener('error', videoFailure);
      video.removeEventListener('playing', working);
      video.removeEventListener('loadeddata', working);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [index, active?.id, active?.url, active?.streamType]);

  const restoreProgress = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const entries = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      const resume = Array.isArray(entries) ? entries.find((entry: any) => entry?.media?.id === media.id) : null;
      const position = Number(resume?.progress || 0);
      if (position >= 5 && Number.isFinite(position) && (!Number.isFinite(video.duration) || position < video.duration - 15)) {
        video.currentTime = position;
      }
    } catch { /* start at beginning */ }
  };

  const saveProgress = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.currentTime)) return;
    if (Date.now() - lastSaveRef.current < 5000) return;
    lastSaveRef.current = Date.now();
    try {
      const key = 'flixleo_continue_watching';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const list = Array.isArray(existing) ? existing : [];
      const entry = { media, progress: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, updatedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify([entry, ...list.filter((r: any) => r?.media?.id !== media.id)].slice(0, 20)));
      onProgressSaved?.();
    } catch { /* playback continues even without storage */ }
  };

  // Stremio streams use the original custom native-style controls only.
  // Other providers retain the existing CinemaPlayer implementation.
  if (initialMirrorId?.startsWith('stremio-')) {
    return <StremioNativePlayer media={media} mirrors={mirrors.filter(m => m.id.startsWith('stremio-'))}
      initialMirrorId={initialMirrorId} minimizeSignal={minimizeSignal} onClose={onClose} onProgressSaved={onProgressSaved} onEpisodeEnded={onEpisodeEnded} />;
  }

  return (
    <section ref={playerAnchorRef} className="w-full max-w-5xl mx-auto rounded-2xl border border-slate-700 bg-[#0b0e15] shadow-xl" aria-label="Movie player">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm sm:text-lg truncate">{media.title}</h2>
          <p className="text-slate-400 text-xs truncate">{active?.label || 'No servers available'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={() => setDocked(true)} className="rounded-lg bg-slate-800 p-2 text-xs text-white" aria-label="Minimize player">Mini player</button><button type="button" onClick={() => void shareMovie()} className="flex items-center gap-1 rounded-lg bg-slate-800 p-2 text-xs text-white" aria-label="Share movie"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={() => { saveProgress(); onClose(); }} className="flex items-center gap-1 rounded-lg bg-slate-800 p-2 text-xs text-white"><ArrowLeft className="h-4 w-4" /> Close</button></div>
      </div>
      <div className={docked ? "fixed z-[65] right-3 bottom-28 md:bottom-8 w-[min(60vw,240px)] md:w-80 aspect-video rounded-xl overflow-hidden border border-amber-500/60 shadow-2xl bg-black" : "aspect-video w-full bg-black relative"}>
        {docked && <div className="absolute z-20 right-1 top-1 flex gap-1"><button type="button" onClick={() => { setDocked(false); playerAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} aria-label="Return to full player" title="Expand player" className="rounded bg-black/80 text-white p-1"><Maximize2 className="h-4 w-4" /></button><button type="button" onClick={() => { saveProgress(); onClose(); }} aria-label="Close mini player" className="rounded bg-black/80 text-white p-1">×</button></div>}
        {!active ? <div className="h-full grid place-items-center text-slate-300">No stream servers available</div>
          : active.streamType === 'embed-iframe'
            ? <iframe key={active.id} src={active.url} title={active.label} className="w-full h-full border-0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />
            : <video key={active.id} ref={videoRef} controls autoPlay playsInline preload="auto" onLoadedMetadata={restoreProgress} onTimeUpdate={saveProgress} onEnded={() => { saveProgress(); onEpisodeEnded?.(); }} className="h-full w-full object-contain" />}
      </div>
      <div className="p-3 sm:p-4 space-y-3">
        {/^(tamil|ta)(?:\\b|\\s|\\W)/i.test(media.language.trim()) && <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-3">
          <p className="text-sm font-semibold text-white">Tamil movies · Einthusan preferred</p>
          <p className="mt-1 text-xs text-slate-300">Browse the official Einthusan Tamil catalogue first. FlixLeo cannot confirm a matching movie or embed permission automatically; existing in-player servers remain available below.</p>
          <a className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black" href="https://einthusan.tv/launcher/?lang=tamil" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Browse Einthusan Tamil</a>
        </div>}
        {qualityLevels.length > 0 && <label className="flex items-center gap-2 text-sm text-white">Video quality
          <select aria-label="Video quality" className="rounded bg-slate-800 border border-slate-600 p-2 text-white" value={selectedQuality} onChange={e => { const level = Number(e.target.value); setSelectedQuality(level); if (hlsRef.current) hlsRef.current.currentLevel = level; }}>
            <option value={-1}>Auto (adaptive)</option>
            {qualityLevels.map(level => <option key={level.level} value={level.level}>{level.height >= 2160 ? '4K UHD (2160p)' : `${level.height}p`}</option>)}
          </select>
        </label>}
        {active?.streamType === 'hls' && !qualityLevels.length && <p className="text-xs text-slate-400">Quality selection depends on stream and browser support. 4K is shown only when the provider offers it.</p>}
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-white text-sm">Select quality &amp; server</h3>
          <span className="text-xs text-slate-400">{mirrors.length} available</span>
        </div>
        {error && <p role="status" className="text-amber-300 text-xs">{error}</p>}
        <select
          aria-label="Select playback quality and server"
          className="w-full min-w-0 rounded-xl border border-slate-600 bg-slate-800 p-3 text-sm text-white focus:border-amber-400 focus:outline-none"
          value={active ? index : ''}
          disabled={!mirrors.length}
          onChange={event => switchServer(Number(event.target.value))}
        >
          {!mirrors.length && <option value="">No streams available</option>}
          {mirrors.map((mirror, i) => (
            <option key={mirror.id + i} value={i}>
              {mirror.quality} · {mirror.label}
            </option>
          ))}
        </select>
        {active?.streamType === 'embed-iframe' && <div className="flex items-center gap-3">
          <button type="button" onClick={autoAdvance} className="text-xs text-amber-300 flex items-center gap-1"><RefreshCw className="h-4 w-4" /> Not working? Try next server</button>
          <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-300 flex items-center gap-1"><ExternalLink className="h-4 w-4" /> Open player</a>
        </div>}
      </div>
    </section>
  );
};
