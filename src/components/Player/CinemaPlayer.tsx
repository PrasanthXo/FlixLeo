import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';

interface CinemaPlayerProps {
  media: MediaItem;
  initialMirrorId?: string;
  minimizeSignal?: number;
  onClose: () => void;
  onProgressSaved?: () => void;
  onMirrorChange?: (mirror: StreamMirror) => void;
  onPlayNext?: () => void;
  hasPlayNext?: boolean;
}

export const CinemaPlayer: React.FC<CinemaPlayerProps> = ({
  media, initialMirrorId, onClose, onProgressSaved, onMirrorChange
}) => {
  const mirrors = media.mirrors || [];
  const [index, setIndex] = useState(() => Math.max(0, mirrors.findIndex(m => m.id === initialMirrorId)));
  const [tried, setTried] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaveRef = useRef(0);
  const active = mirrors[index];
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
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else if (Hls.isSupported()) {
        const hls = new Hls();
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

  return (
    <section className="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-slate-700 bg-[#0b0e15] shadow-xl" aria-label="Movie player">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm sm:text-lg truncate">{media.title}</h2>
          <p className="text-slate-400 text-xs truncate">{active?.label || 'No servers available'}</p>
        </div>
        <button type="button" onClick={() => { saveProgress(); onClose(); }} className="flex items-center gap-1 rounded-lg bg-slate-800 p-2 text-xs text-white"><ArrowLeft className="h-4 w-4" /> Close</button>
      </div>
      <div className="aspect-video w-full bg-black relative">
        {!active ? <div className="h-full grid place-items-center text-slate-300">No stream servers available</div>
          : active.streamType === 'embed-iframe'
            ? <iframe key={active.id} src={active.url} title={active.label} className="w-full h-full border-0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />
            : <video key={active.id} ref={videoRef} controls autoPlay playsInline preload="auto" onTimeUpdate={saveProgress} onEnded={saveProgress} className="h-full w-full object-contain" />}
      </div>
      <div className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-white text-sm">Available servers</h3>
          <span className="text-xs text-slate-400">{mirrors.length} listed</span>
        </div>
        <p className="text-xs text-slate-400">Select a different server below the player. Direct video and HLS servers switch automatically on detectable playback errors. Embedded players may not report errors to FlixLeo.</p>
        {error && <p role="status" className="text-amber-300 text-xs">{error}</p>}
        <div className="flex flex-wrap gap-2">{mirrors.map((mirror, i) => (
          <button type="button" key={mirror.id + i} onClick={() => switchServer(i)} aria-pressed={index === i}
            className={`rounded-lg px-3 py-2 text-xs font-medium border ${index === i ? 'border-amber-500 bg-amber-500 text-black' : 'border-slate-700 bg-slate-800 text-slate-200'}`}>
            {index === i ? '▶ ' : ''}{mirror.label} {mirror.quality}
          </button>
        ))}</div>
        {active?.streamType === 'embed-iframe' && <div className="flex items-center gap-3">
          <button type="button" onClick={autoAdvance} className="text-xs text-amber-300 flex items-center gap-1"><RefreshCw className="h-4 w-4" /> Not working? Try next server</button>
          <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-300 flex items-center gap-1"><ExternalLink className="h-4 w-4" /> Open player</a>
        </div>}
      </div>
    </section>
  );
};
