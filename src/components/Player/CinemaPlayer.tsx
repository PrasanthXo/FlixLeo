import { DesktopNativeSurface, desktopBridge, useDesktopWindowFullscreen, useDesktopControlsVisible } from './DesktopNativeSurface';
import { DesktopFullscreenControls, DesktopAspectRatioPicker, type NativeAspectRatio } from './DesktopFullscreenControls';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { StremioNativePlayer } from './StremioNativePlayer';
import { ArrowLeft, ExternalLink, RefreshCw, Share2, Maximize2, Minimize2, X } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';
import { isFlixLeoAndroid, launchFlixLeoAndroidStream, savedAndroidPosition, saveFlixLeoAndroidProgress, type AndroidPlaybackResult } from '../../lib/androidNative';

const resumeKey = (m: MediaItem) => m.id + (m.playbackSeason !== undefined && m.playbackEpisode !== undefined ? ':s' + m.playbackSeason + 'e' + m.playbackEpisode : '');
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
  // Sentinel remains in document flow even when the native video docks.
  const videoEndSentinelRef = useRef<HTMLDivElement>(null);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const [frameFullscreen, setFrameFullscreen] = useState(false);
  const nativeWindowFullscreen = useDesktopWindowFullscreen();
  useEffect(() => {
    const update = () => setFrameFullscreen(document.fullscreenElement === playerFrameRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggleFrameFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await playerFrameRef.current?.requestFullscreen();
    } catch { window.alert('Fullscreen is unavailable for this player.'); }
  };
  const [docked, setDocked] = useState(false);
  const manualMinimize = useRef(false);
  // Older saved catalogue entries can still contain the defunct embed.su mirror.
  const mirrors = (media.mirrors || []).filter(m => !/^https?:\/\/embed\.su(?:\/|$)/i.test(m.url));
  const [index, setIndex] = useState(() => Math.max(0, mirrors.findIndex(m => m.id === (initialMirrorId || (() => { try { const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]'); const saved = Array.isArray(rows) ? rows.find((row: any) => row?.media && resumeKey(row.media) === resumeKey(media)) : undefined; return saved?.mirrorId && mirrors.some(m => m.id === saved.mirrorId) ? saved.mirrorId : undefined; } catch { return undefined; } })()))));
  const [tried, setTried] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<{ level: number; height: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaveRef = useRef(0);
  const active = mirrors[index];
  const desktopNative = Boolean(desktopBridge() && active && active.streamType !== 'embed-iframe');
  const isDelegated = Boolean(initialMirrorId?.startsWith('stremio-') || media.id.startsWith('plavio-live-'));
  const androidNative = Boolean(!isDelegated && isFlixLeoAndroid() && active && active.streamType !== 'embed-iframe');
  const lastAndroidLaunch = useRef('');
  useEffect(() => {
    if (!androidNative || !active?.url) return;
    const launchKey = active.id + ':' + active.url;
    if (lastAndroidLaunch.current === launchKey) return;
    lastAndroidLaunch.current = launchKey;
    if (!launchFlixLeoAndroidStream(active.url, media.title, active.id, savedAndroidPosition(media))) {
      setError('This source cannot be played in the Android app.');
    }
  }, [androidNative, active?.id, active?.url, media.id, media.title]);
  useEffect(() => {
    if (!androidNative) return;
    const finished = (event: Event) => {
      const result = (event as CustomEvent<AndroidPlaybackResult>).detail;
      if (!result || result.mirrorId !== active?.id) return;
      saveFlixLeoAndroidProgress(media, active.id, result);
      onProgressSaved?.();
      if (result.ended) onEpisodeEnded?.();
    };
    window.addEventListener('flixleo:android-player-result', finished);
    return () => window.removeEventListener('flixleo:android-player-result', finished);
  }, [androidNative, active?.id, media.id, media.playbackSeason, media.playbackEpisode, onEpisodeEnded, onProgressSaved]);
  const nativeFullscreen = desktopNative && nativeWindowFullscreen;
  const fullscreenControlsVisible = useDesktopControlsVisible(nativeFullscreen);
  const [aspectRatio, setAspectRatio] = useState<NativeAspectRatio>('no');
  const changeAspectRatio = (ratio: NativeAspectRatio) => {
    setAspectRatio(ratio);
    void desktopBridge()?.commandNative('setAspectRatio', ratio);
  };
  useEffect(() => { setAspectRatio('no'); }, [active?.url]);
  useEffect(() => { if (nativeFullscreen) { manualMinimize.current = false; setDocked(false); } }, [nativeFullscreen]);
  const hasShownMainPlayer = useRef(false);
  const lastMinimizeSignal = useRef(minimizeSignal);
  useEffect(() => {
    if (desktopNative) return; // Native video uses the real video-bottom sentinel instead.
    const anchor = playerAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (!entry || document.fullscreenElement) return;
      // Never create a mini-player until the large player was visible once.
      if (entry.isIntersecting) {
        hasShownMainPlayer.current = true;
        setDocked(false);
      } else if (hasShownMainPlayer.current && entry.boundingClientRect.bottom < -8) {
        setDocked(true);
      }
    }, { threshold: 0 });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [desktopNative]);
  // Use the video viewport, not the entire movie/settings section, to
  // switch to mini-player as soon as the big video leaves the screen.
  // A same-sized placeholder keeps this point stable when the frame is fixed.
  useEffect(() => {
    if (!desktopNative || nativeFullscreen) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const end = videoEndSentinelRef.current;
      if (!end || document.fullscreenElement || manualMinimize.current) return;
      const pastVideo = end.getBoundingClientRect().top < 12;
      setDocked(current => current === pastVideo ? current : pastVideo);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [desktopNative, nativeFullscreen]);
  useEffect(() => {
    if (minimizeSignal > lastMinimizeSignal.current) setDocked(true);
    lastMinimizeSignal.current = minimizeSignal;
  }, [minimizeSignal]);
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
    if (desktopNative || androidNative) { setReady(true); return; }
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
      const resume = Array.isArray(entries) ? entries.find((entry: any) => entry?.media && resumeKey(entry.media) === resumeKey(media)) : null;
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
      const entry = { media, mirrorId: active?.id, progress: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, updatedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify([entry, ...list.filter((r: any) => !r?.media || resumeKey(r.media) !== resumeKey(media))].slice(0, 20)));
      onProgressSaved?.();
    } catch { /* playback continues even without storage */ }
  };

  // PlavioHD live channels are also Stremio streams, not legacy catalog videos.
  // Use the HLS/DASH-capable player (and its per-source retry handling) for both.
  if (initialMirrorId?.startsWith('stremio-') || media.id.startsWith('plavio-live-')) {
    const compatibleMirrors = mirrors.filter(m => m.id.startsWith('stremio-') || m.id.startsWith('plavio-live-'));
    return <StremioNativePlayer media={media} mirrors={compatibleMirrors.length ? compatibleMirrors : mirrors}
      initialMirrorId={initialMirrorId} minimizeSignal={minimizeSignal} onClose={onClose} onProgressSaved={onProgressSaved} onEpisodeEnded={onEpisodeEnded} />;
  }

  return (
    <section ref={playerAnchorRef} className="tv6-cinema-shell w-full max-w-5xl mx-auto rounded-2xl border border-slate-700 bg-[#0b0e15] shadow-xl" aria-label="Movie player">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm sm:text-lg truncate">{media.title}</h2>
          <p className="text-slate-400 text-xs truncate">{active?.label || 'No servers available'}</p>
        </div>
        {desktopNative && !nativeFullscreen && !docked && <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => { manualMinimize.current = true; setDocked(true); }} className="rounded-lg border border-amber-500/30 bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-700" aria-label="Minimize native video to mini player"><Minimize2 className="mr-1 inline h-4 w-4" />Mini player</button>
          <button type="button" onClick={() => { saveProgress(); onClose(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/30" title="Stop playback and close player" aria-label="Close Windows video player"><X size={16} />Close player</button>
        </div>}
        {!desktopNative && <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={() => setDocked(true)} className="rounded-lg bg-slate-800 p-2 text-xs text-white" aria-label="Minimize player">Mini player</button><button type="button" onClick={() => void shareMovie()} className="flex items-center gap-1 rounded-lg bg-slate-800 p-2 text-xs text-white" aria-label="Share movie"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={() => { saveProgress(); onClose(); }} className="flex items-center gap-1 rounded-lg bg-slate-800 p-2 text-xs text-white"><ArrowLeft className="h-4 w-4" /> Close</button></div>}
      </div>
      {docked && desktopNative && !nativeFullscreen && <div className="aspect-video w-full" aria-hidden="true" />}
      <div ref={playerFrameRef} className={nativeFullscreen ? "fixed inset-0 z-[200] h-screen w-screen overflow-hidden bg-black" : docked ? "fixed z-[65] right-3 bottom-28 md:bottom-8 w-[min(60vw,240px)] md:w-80 h-[232px] rounded-xl overflow-hidden border border-amber-500/60 shadow-2xl bg-black" : "tv6-cinema-frame aspect-video w-full bg-black relative"} style={frameFullscreen && !desktopNative ? { position: "fixed", inset: 0, top: 0, right: 0, bottom: 0, left: 0, width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none", aspectRatio: "auto" } : undefined}>
        {!desktopNative && !docked && <button type="button" onClick={() => void toggleFrameFullscreen()} className="absolute z-[60] right-3 top-3 rounded-lg bg-black/85 px-3 py-2 text-xs font-semibold text-white hover:bg-black border border-white/20" aria-label={frameFullscreen ? "Exit fullscreen player" : "Fullscreen player"}>{frameFullscreen ? "Exit fullscreen" : "⛶ Fullscreen"}</button>}
        {docked && !desktopNative && <div className="absolute z-[70] left-2 top-2 flex gap-1"><button type="button" onClick={() => { playerAnchorRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); setDocked(false); }} aria-label="Return to full player" title="Expand player" className="rounded bg-black/80 text-white p-1"><Maximize2 className="h-4 w-4" /></button><button type="button" onClick={() => { saveProgress(); onClose(); }} aria-label="Close mini player" className="rounded bg-black/80 text-white p-1">×</button></div>}
        {!active ? <div className="h-full grid place-items-center text-slate-300">No stream servers available</div>
          : desktopNative ? <div className={nativeFullscreen ? (fullscreenControlsVisible ? "h-[calc(100%-96px)] w-full" : "h-full w-full") : docked ? "h-[calc(100%-52px)] w-full" : "h-full w-full"}><DesktopNativeSurface key={active.id} url={active.url} media={media} mirrorId={active.id} onProgressSaved={onProgressSaved} /></div>
          : androidNative ? <div className="flex h-full flex-col items-center justify-center gap-4 bg-black p-5 text-white"><p className="text-sm text-slate-300">Playing in the FlixLeo Android app</p><button type="button" onClick={() => launchFlixLeoAndroidStream(active.url, media.title, active.id, savedAndroidPosition(media))} className="rounded-xl bg-amber-400 px-5 py-3 font-semibold text-black">▶ Open native player</button></div>
          : active.streamType === 'embed-iframe'
            ? <iframe key={active.id} src={active.url} title={active.label} className="w-full h-full border-0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />
            : <video key={active.id} ref={videoRef} controls autoPlay playsInline preload="auto" onDoubleClick={() => void toggleFrameFullscreen()} onLoadedMetadata={restoreProgress} onTimeUpdate={saveProgress} onEnded={() => { saveProgress(); onEpisodeEnded?.(); }} className="h-full w-full object-contain" />}
        {nativeFullscreen && <DesktopFullscreenControls title={media.title} onClose={() => { saveProgress(); onClose(); }} visible={fullscreenControlsVisible} aspectRatio={aspectRatio} onAspectRatioChange={changeAspectRatio} />}
        {docked && desktopNative && <div className="absolute bottom-0 left-0 right-0 z-[90] flex h-[52px] items-center justify-around gap-1 border-t border-white/15 bg-[#151925] px-2 text-white">
          <button type="button" aria-label="Rewind 10 seconds" className="rounded-lg p-2 text-white" onClick={() => void desktopBridge()?.commandNative('seekBackward')}>↶</button>
          <button type="button" aria-label="Play or pause" className="rounded-lg bg-amber-400 px-3 py-2 text-black" onClick={() => void desktopBridge()?.commandNative('togglePause')}>▶Ⅱ</button>
          <button type="button" aria-label="Forward 10 seconds" className="rounded-lg p-2 text-white" onClick={() => void desktopBridge()?.commandNative('seekForward')}>↷</button>
          <button type="button" aria-label="Expand mini player" className="rounded-lg p-2 text-white" onClick={() => { manualMinimize.current = false; setDocked(false); playerAnchorRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }); }}><Maximize2 size={18}/></button>
          <button type="button" aria-label="Close mini player" className="rounded-lg p-2 text-white" onClick={() => { saveProgress(); onClose(); }}>✕</button>
        </div>}
      </div>
      <div ref={videoEndSentinelRef} className="h-px pointer-events-none" aria-hidden="true" />
      <div className="p-3 sm:p-4 space-y-3">
        {desktopNative && !nativeFullscreen && <div className="flex flex-wrap items-center gap-3">
          <button type="button" aria-label="Fullscreen" title="Fullscreen · Esc to exit" onClick={() => void desktopBridge()?.commandNative('toggleFullscreen')} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-white">⛶ Fullscreen</button>
          <DesktopAspectRatioPicker value={aspectRatio} onChange={changeAspectRatio} />
          <button type="button" onClick={() => { saveProgress(); onClose(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/30" title="Stop playback and close player" aria-label="Close Windows video player"><X size={16} />Close player</button>
        </div>}
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
              {mirror.quality} · {mirror.label}{mirror.fileSize ? ' · ' + mirror.fileSize : ''}
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
