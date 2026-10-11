import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  RotateCcw, RotateCw, Settings, ShieldCheck, Download,
  Layers, SunMedium, Moon, ArrowLeft, FastForward, Check,
  Lock, Unlock, Volume1, Clock, MonitorPlay,
  SkipForward, HelpCircle, X, ExternalLink, RefreshCw, Film
} from 'lucide-react';
import { MediaItem, StreamMirror, QualityOption, getSourceDisplayBadge } from '../../types/stream';

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
  media,
  initialMirrorId,
  minimizeSignal = 0,
  onClose,
  onProgressSaved,
  onMirrorChange,
  onPlayNext,
  hasPlayNext
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastProgressSaveRef = useRef<number>(-1);
  const dockPositionRef = useRef<number | null>(null);
  const dockWasPlayingRef = useRef(false);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Audio Context for booster
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Initial mirror
  const [selectedMirror, setSelectedMirror] = useState<StreamMirror>(() => {
    if (initialMirrorId) {
      const found = media.mirrors.find(m => m.id === initialMirrorId);
      if (found) return found;
    }
    return media.mirrors[0];
  });

  const [iframeReloadKey, setIframeReloadKey] = useState<number>(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [ambientGlow, setAmbientGlow] = useState<boolean>(true);
  const [theaterMode, setTheaterMode] = useState<boolean>(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<'16/9' | '21/9' | '4/3' | 'cover'>('16/9');
  const [audioBoost, setAudioBoost] = useState<number>(1.0);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string>(
    media.audioTracks && media.audioTracks[0] ? media.audioTracks[0] : 'Original Audio Track'
  );
  const [availableAudioTracks, setAvailableAudioTracks] = useState<{ index: number; name: string; lang: string }[]>([]);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(-1);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('en');
  const [selectedQuality, setSelectedQuality] = useState<QualityOption>(selectedMirror.quality);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isTouchLocked, setIsTouchLocked] = useState<boolean>(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [showMirrorMenu, setShowMirrorMenu] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [hasPlaybackError, setHasPlaybackError] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast notification
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Switch active mirror
  const handleSelectMirror = (mirror: StreamMirror) => {
    setAvailableAudioTracks([]);
    setActiveAudioIndex(-1);
    setSelectedMirror(mirror);
    setSelectedQuality(mirror.quality);
    setHasPlaybackError(false);
    setErrorMessage('');
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setShowMirrorMenu(false);
    triggerToast(`Switched to ${mirror.label}`);
    if (onMirrorChange) onMirrorChange(mirror);
  };

  // Closing must terminate the current media resource, not just hide the window.
  const stopAndClose = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
      video.load();
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (iframeRef.current) iframeRef.current.src = 'about:blank';
    setIsPlaying(false);
    setIsBuffering(false);
    onClose();
  };

  const setDocked = (minimized: boolean) => {
    const video = videoRef.current;
    if (video && selectedMirror.streamType !== 'embed-iframe') {
      dockPositionRef.current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      dockWasPlayingRef.current = !video.paused;
    }
    setIsMiniPlayer(minimized);
  };

  const lastMinimizeSignal = useRef(minimizeSignal);
  useEffect(() => {
    if (minimizeSignal !== lastMinimizeSignal.current) {
      lastMinimizeSignal.current = minimizeSignal;
      setDocked(true);
    }
  }, [minimizeSignal]);

  // Format time (hh:mm:ss or mm:ss)
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Setup stream with HLS or Native HTML5 Video
  useEffect(() => {
    setAvailableAudioTracks([]);
    setActiveAudioIndex(-1);
    // If embed iframe mirror is active, bypass HTML5 video setup
    if (selectedMirror.streamType === 'embed-iframe') {
      setIsBuffering(false);
      setHasPlaybackError(false);
      setErrorMessage('');
      setIsPlaying(false);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const dockPosition = dockPositionRef.current;
    const resumeDockPlayback = dockPosition !== null ? dockWasPlayingRef.current : true;
    dockPositionRef.current = null;
    const restoreDockPosition = () => {
      if (dockPosition !== null && dockPosition > 0) {
        try { video.currentTime = dockPosition; } catch { /* wait for metadata */ }
      }
    };

    setIsBuffering(true);
    setHasPlaybackError(false);
    setErrorMessage('');
    setCurrentTime(0);
    setDuration(0);

    // Reveal a recoverable error instead of an endless loading spinner.
    const loadingTimeout = window.setTimeout(() => {
      if (video.readyState < 2) {
        setIsBuffering(false);
        setErrorMessage('This mirror did not respond in time. Retry it or choose another mirror.');
        setHasPlaybackError(true);
      }
    }, 20000);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const streamUrl = selectedMirror.url;
    const isHls = streamUrl.includes('.m3u8') || selectedMirror.streamType === 'hls';

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });
      hlsRef.current = hls;
      const syncAudioTracks = () => {
        setAvailableAudioTracks(hls.audioTracks.map((track, index) => ({
          index, name: track.name || track.lang || `Track ${index + 1}`, lang: track.lang || ''
        })));
        setActiveAudioIndex(hls.audioTrack);
      };
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncAudioTracks);
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, syncAudioTracks);
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        const savedTime = dockPosition === null ? localStorage.getItem(`cinehub_prog_${media.id}`) : null;
        restoreDockPosition();
        if (savedTime && parseFloat(savedTime) > 10) {
          video.currentTime = parseFloat(savedTime);
          triggerToast(`Resumed playback at ${formatTime(parseFloat(savedTime))}`);
        }
        if (resumeDockPlayback) video.play().catch(() => setIsPlaying(false));
      });

      let recoveryAttempts = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          recoveryAttempts++;
          if (recoveryAttempts > 2) {
            setIsBuffering(false);
            setErrorMessage('The stream server failed to deliver playable video. Try another mirror.');
            setHasPlaybackError(true);
            hls.destroy();
            return;
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setIsBuffering(false);
              setHasPlaybackError(true);
              break;
          }
        }
      });
    } else {
      video.src = streamUrl;
      video.load();

      const savedTime = dockPosition === null ? localStorage.getItem(`cinehub_prog_${media.id}`) : null;
      video.addEventListener('loadedmetadata', restoreDockPosition, { once: true });
      if (savedTime && parseFloat(savedTime) > 10) {
        video.currentTime = parseFloat(savedTime);
      }

      if (resumeDockPlayback) video.play().catch(() => setIsPlaying(false));
    }

    return () => {
      video.removeEventListener('loadedmetadata', restoreDockPosition);
      window.clearTimeout(loadingTimeout);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [selectedMirror, media.id, isMiniPlayer]);

  // Video event listeners & audio setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => {
      setIsBuffering(false);
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      }
      const progressSecond = Math.floor(video.currentTime);
      if (progressSecond >= 5 && (lastProgressSaveRef.current < 0 || progressSecond - lastProgressSaveRef.current >= 5)) {
        lastProgressSaveRef.current = progressSecond;
        localStorage.setItem(`cinehub_prog_${media.id}`, video.currentTime.toString());
        try {
          const saved = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
          const existing = Array.isArray(saved) ? saved.filter((entry: any) => entry?.media?.id !== media.id) : [];
          if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime / video.duration >= 0.95) {
            localStorage.setItem('flixleo_continue_watching', JSON.stringify(existing.slice(0, 19)));
          } else {
            localStorage.setItem('flixleo_continue_watching', JSON.stringify([{ media, progress: video.currentTime, duration: video.duration || 0, updatedAt: Date.now() }, ...existing].slice(0, 20)));
          }
          onProgressSaved?.();
        } catch { /* storage may be restricted */ }
      }
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setIsBuffering(false);
    };

    const onError = (e: Event) => {
      e.stopPropagation();
      setIsBuffering(false);
      setErrorMessage('The browser could not play this stream. Check the source or select another mirror.');
      setHasPlaybackError(true);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
    };
  }, [media.id, onProgressSaved]);

  // Audio Booster (Web Audio API)
  const applyAudioBoost = (level: number) => {
    setAudioBoost(level);
    try {
      if (!audioContextRef.current && videoRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const gain = ctx.createGain();
          const source = ctx.createMediaElementSource(videoRef.current);
          source.connect(gain);
          gain.connect(ctx.destination);
          audioContextRef.current = ctx;
          gainNodeRef.current = gain;
        }
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = level;
      }
    } catch {
      // AudioContext already connected or cross-origin restricted
    }
    triggerToast(`Audio Volume Boost: ${Math.round(level * 100)}%`);
  };

  // Sleep Timer Handler
  const handleSetSleepTimer = (mins: number | null) => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepTimerMinutes(mins);
    setShowSettingsMenu(false);

    if (mins) {
      triggerToast(`Sleep timer set: ${mins} minutes`);
      sleepTimerRef.current = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.pause();
          triggerToast('Sleep timer reached: Playback stopped');
        }
      }, mins * 60 * 1000);
    } else {
      triggerToast('Sleep timer disabled');
    }
  };

  // Reset controls timer
  const handleUserActivity = useCallback(() => {
    if (isTouchLocked) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showMirrorMenu && !showSettingsMenu) {
        setShowControls(false);
      }
    }, 3200);
  }, [isPlaying, showMirrorMenu, showSettingsMenu, isTouchLocked]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (isTouchLocked) return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          triggerToast('-10s');
          break;
        case 'ArrowRight':
        case 'KeyL':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          triggerToast('+10s');
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          setIsMuted(false);
          triggerToast(`Volume ${Math.round(video.volume * 100)}%`);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          triggerToast(`Volume ${Math.round(video.volume * 100)}%`);
          break;
        case 'KeyM':
          e.preventDefault();
          video.muted = !video.muted;
          setIsMuted(video.muted);
          triggerToast(video.muted ? 'Muted' : 'Unmuted');
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyT':
          e.preventDefault();
          setTheaterMode(!theaterMode);
          triggerToast(!theaterMode ? 'Theater Mode' : 'Standard Cinema');
          break;
        case 'Slash':
          if (e.shiftKey) {
            e.preventDefault();
            setShowShortcutsModal(true);
          }
          break;
        case 'Escape':
          if (isFullscreen) {
            if (document.exitFullscreen) document.exitFullscreen();
          } else if (showShortcutsModal) {
            setShowShortcutsModal(false);
          } else {
            setDocked(true);
          }
          break;
      }
      handleUserActivity();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, handleUserActivity, onClose, isTouchLocked, theaterMode, showShortcutsModal]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Play/Pause toggle
  const togglePlay = () => {
    if (isTouchLocked) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  // Seek handler
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = parseFloat(e.target.value);
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const setSpeed = (spd: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = spd;
    setPlaybackSpeed(spd);
    setShowSettingsMenu(false);
    triggerToast(`${spd}x Speed`);
  };

  const skipIntro = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration, video.currentTime + 85);
    triggerToast('Skipped Intro (+85s)');
  };

  // Aspect ratio class mapper
  const getVideoAspectClass = () => {
    switch (aspectRatio) {
      case '21/9':
        return 'aspect-[21/9] object-contain';
      case '4/3':
        return 'aspect-[4/3] object-contain';
      case 'cover':
        return 'w-full h-full object-cover';
      default:
        return 'aspect-video object-contain';
    }
  };

  // Floating Mini-Player View
  if (isMiniPlayer) {
    return (
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 w-80 md:w-96 z-50 rounded-2xl overflow-hidden shadow-2xl border border-amber-500/50 bg-[#0a0d14] animate-fade-in group">
        <div className="relative aspect-video bg-black flex items-center justify-center">
          {selectedMirror.streamType === 'embed-iframe' ? (
            <iframe
              ref={iframeRef}
              src={selectedMirror.url}
              className="w-full h-full border-0"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              title={media.title}
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              preload="auto"
              onClick={togglePlay}
              className="w-full h-full object-contain cursor-pointer"
            />
          )}

          {/* Embedded providers must receive touch/mouse input to expose their own controls. */}
          <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-between ${selectedMirror.streamType === 'embed-iframe' ? 'pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between text-white">
              <span className="text-xs font-bold truncate max-w-[200px]">{media.title}</span>
              <div className="flex items-center gap-1.5 pointer-events-auto">
                <button
                  onClick={() => setDocked(false)}
                  className="p-1 rounded bg-black/60 hover:bg-slate-800 text-slate-200"
                  title="Expand to Full Cinema View"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={stopAndClose}
                  aria-label="Close mini-player and stop playback"
                  className="p-1 rounded bg-black/60 hover:bg-red-950 text-slate-200 hover:text-red-400"
                  title="Close Stream"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              {selectedMirror.streamType !== 'embed-iframe' && <button
                onClick={togglePlay}
                className="w-8 h-8 rounded-full bg-amber-500 text-black flex items-center justify-center font-bold"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              </button>}
              {selectedMirror.streamType === 'embed-iframe' ? <span className="text-[10px] text-slate-300">Use provider controls</span> : <span className="text-[10px] font-mono text-slate-300">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      className={`relative flex flex-col bg-black text-white select-none transition-all duration-300 w-full ${
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none border-none m-0 max-w-none h-screen'
          : theaterMode
          ? 'w-full'
          : 'max-w-6xl mx-auto sm:rounded-2xl shadow-2xl border-0 sm:border border-slate-800/80 sm:my-4'
      }`}
      style={{ aspectRatio: isFullscreen ? undefined : '16 / 9', minHeight: 0 }}
    >
      {/* Ambient Cinema Glow backdrop */}
      {ambientGlow && (
        <div
          className="absolute -inset-4 bg-radial from-amber-500/10 via-sky-500/5 to-transparent blur-3xl pointer-events-none -z-10 transition-opacity duration-700"
          style={{ opacity: isPlaying ? 0.7 : 0.2 }}
        />
      )}

      {/* Screen Touch Lock Overlay for Mobile */}
      {isTouchLocked && (
        <div className="absolute top-4 left-4 z-40">
          <button
            onClick={() => {
              setIsTouchLocked(false);
              triggerToast('Screen unlocked');
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/85 border border-amber-500/60 text-amber-300 text-xs font-semibold backdrop-blur-md shadow-2xl"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Tap to Unlock</span>
          </button>
        </div>
      )}

      {/* Main Video Element or Embed Iframe */}
      {selectedMirror.streamType === 'embed-iframe' ? (
        <div className="absolute inset-0 w-full h-full bg-black">
          <iframe
            key={selectedMirror.id}
            ref={iframeRef}
            src={selectedMirror.url}
            className="w-full h-full border-0 absolute inset-0 bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            title={media.title}
          />
        </div>
      ) : (
        <video
          ref={videoRef}
          key={selectedMirror.id}
          playsInline
          preload="auto"
          onClick={togglePlay}
          onError={(e) => e.stopPropagation()}
          className={`absolute inset-0 w-full h-full cursor-pointer bg-black ${getVideoAspectClass()}`}
        />
      )}

      {/* Buffering spinner */}
      {isBuffering && selectedMirror.streamType !== 'embed-iframe' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none z-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border-3 border-amber-400 border-t-transparent animate-spin" />
            <span className="text-xs font-mono tracking-wider text-slate-300">
              BUFFERING {selectedMirror.label.split('·')[0]}
            </span>
          </div>
        </div>
      )}

      {/* Stream Playback Error Recovery Overlay */}
      {hasPlaybackError && (
        <div className="absolute inset-0 z-30 bg-black/95 backdrop-blur-md flex items-center justify-center p-6 text-center animate-fade-in">
          <div className="max-w-md w-full bg-slate-900 border border-amber-500/50 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto">
              <Film className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">Stream Playback Interrupted</h3>
            <p className="text-xs text-slate-300">
              {errorMessage || `The current mirror (${selectedMirror.label}) could not be loaded. Try another mirror.`}
            </p>
            <div className="space-y-2 pt-2 text-left max-h-48 overflow-y-auto">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Select Alternative Working Mirror:
              </div>
              {media.mirrors.map((mirror) => (
                <button
                  key={mirror.id}
                  onClick={() => {
                    setHasPlaybackError(false);
                    handleSelectMirror(mirror);
                  }}
                  className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    mirror.id === selectedMirror.id
                      ? 'bg-amber-500 text-black font-bold'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <span className="truncate pr-2">{mirror.label}</span>
                  <span className="text-[10px] font-mono shrink-0 px-2 py-0.5 rounded bg-black/40 text-amber-300">
                    {mirror.quality}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setHasPlaybackError(false);
                setErrorMessage('');
                if (videoRef.current) {
                  videoRef.current.load();
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors"
            >
              Retry Current Mirror
            </button>
          </div>
        </div>
      )}

      {/* Floating In-Player Toast */}
      {toastMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-black/85 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700/80 text-xs font-medium text-amber-300 shadow-xl pointer-events-none animate-fade-in">
          {toastMessage}
        </div>
      )}

      {/* Top Overlay Bar */}
      {!isTouchLocked && (
        <div
          className={`absolute top-0 left-0 right-0 p-3 md:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-3 z-30 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setDocked(true)}
              className="w-10 h-10 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-200 transition-colors shrink-0"
              title="Return to catalog and keep playing in mini-player"
              aria-label="Minimize player"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm md:text-base font-bold text-white truncate max-w-xs md:max-w-md">
                {media.title}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{media.year}</span>
                <span aria-hidden="true">·</span>
                <span>{media.duration}</span>
                <span aria-hidden="true">·</span>
                <span className="text-amber-400 font-medium">IMDb {media.imdbRating}</span>
                <span aria-hidden="true">·</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold border bg-slate-800 text-slate-300 border-slate-700 uppercase">
                  {selectedMirror.source}
                </span>
              </div>
            </div>
          </div>

          {/* Top Right Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Mirror Switcher */}
            <div className="relative">
              <button
                onClick={() => setShowMirrorMenu(!showMirrorMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors"
                title="Change Stream Mirror"
              >
                <Layers className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Mirrors ({media.mirrors.length})</span>
              </button>

              {showMirrorMenu && (
                <div className="fixed left-4 right-4 top-32 w-auto max-w-md mx-auto sm:absolute sm:top-auto sm:left-auto sm:right-0 sm:w-80 mt-2 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl p-2 z-[70] max-h-[65dvh] overflow-y-auto">
                  <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    Select Streaming Mirror
                  </div>
                  <div className="mt-1 space-y-1 max-h-64 overflow-y-auto no-scrollbar">
                    {media.mirrors.map((mirror) => {
                      const isCurrent = mirror.id === selectedMirror.id;
                      return (
                        <button
                          key={mirror.id}
                          onClick={() => handleSelectMirror(mirror)}
                          className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                            isCurrent
                              ? 'bg-amber-500/20 text-white border border-amber-500/40'
                              : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold truncate flex items-center gap-1.5">
                              {mirror.label}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span>{mirror.quality}</span>
                              {mirror.fileSize && <span>· {mirror.fileSize}</span>}
                              {mirror.serverNode && <span>· {mirror.serverNode}</span>}
                            </div>
                          </div>
                          {isCurrent && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Lock Screen */}
            <button
              onClick={() => {
                setIsTouchLocked(true);
                setShowControls(false);
                triggerToast('Touch screen locked');
              }}
              className="w-9 h-9 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300"
              title="Lock Touch Screen Controls"
            >
              <Lock className="w-4 h-4" />
            </button>

            {/* Mini Player Dock */}
            <button
              onClick={() => setIsMiniPlayer(true)}
              className="w-9 h-9 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300"
              title="Dock to Floating Mini-Player"
            >
              <MonitorPlay className="w-4 h-4" />
            </button>

            {/* Direct Download */}
            {selectedMirror.downloadUrl && (
              <a
                href={selectedMirror.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="w-9 h-9 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-amber-400 transition-colors"
                title="Download Direct Stream"
              >
                <Download className="w-4 h-4" />
              </a>
            )}

            {/* Ambient Glow */}
            <button
              onClick={() => setAmbientGlow(!ambientGlow)}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
                ambientGlow ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-slate-900/80 border-slate-700 text-slate-400'
              }`}
              title="Toggle Cinema Ambient Glow"
            >
              {ambientGlow ? <SunMedium className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Skip Intro Floating Action */}
      {!isTouchLocked && currentTime < 180 && currentTime > 5 && showControls && (
        <button
          onClick={skipIntro}
          className="absolute bottom-24 right-6 z-30 px-4 py-2 rounded-lg bg-black/85 hover:bg-black border border-amber-500/50 text-amber-300 hover:text-amber-200 text-xs font-semibold backdrop-blur-md shadow-xl flex items-center gap-2 transition-transform active:scale-95"
        >
          <FastForward className="w-4 h-4" />
          Skip Intro (+85s)
        </button>
      )}

      {/* Up Next floating trigger (if at end of video or hasPlayNext) */}
      {!isTouchLocked && hasPlayNext && onPlayNext && duration > 0 && currentTime > duration - 60 && (
        <button
          onClick={onPlayNext}
          className="absolute bottom-24 left-6 z-30 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold shadow-2xl flex items-center gap-2 animate-bounce"
        >
          <SkipForward className="w-4 h-4 fill-current" />
          Play Next Title
        </button>
      )}

      {/* Embedded providers own their own playback controls. */}
      {/* Bottom Overlay Controls */}
      {!isTouchLocked && selectedMirror.streamType !== 'embed-iframe' && (
        <div
          className={`absolute bottom-0 left-0 right-0 p-2 sm:p-4 md:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Scrub Bar */}
          <div className="relative group mb-3">
            <div className="w-full h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden relative">
              <div
                className="absolute top-0 bottom-0 left-0 bg-slate-600/70 transition-all duration-200"
                style={{ width: `${(bufferedEnd / (duration || 1)) * 100}%` }}
              />
              <div
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-amber-500 to-amber-400"
                style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
              />
            </div>

            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek timeline"
            />
          </div>

          {/* Lower Controls Row */}
          <div className="flex flex-row flex-wrap items-center justify-between gap-1 sm:gap-3">
            {/* Left: Playback & Volume */}
            <div className="flex items-center gap-1 sm:gap-3">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center font-bold shadow-lg transition-transform active:scale-95 shrink-0"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                  }
                }}
                className="w-9 h-9 rounded-full hover:bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white"
                title="Seek back 10 seconds"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
                  }
                }}
                className="w-9 h-9 rounded-full hover:bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white"
                title="Seek forward 10 seconds"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Volume & Audio Boost */}
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="w-8 h-8 rounded-full hover:bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 md:w-20 accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  aria-label="Volume slider"
                />
                {audioBoost > 1 && (
                  <span className="text-[10px] font-mono font-bold text-amber-400">
                    +{Math.round((audioBoost - 1) * 100)}% Boost
                  </span>
                )}
              </div>

              {/* Time Stamp */}
              <div className="text-xs font-mono text-slate-300 tabular-nums ml-1">
                <span>{formatTime(currentTime)}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span className="text-slate-400">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right: Quality, Settings, Aspect Ratio, Fullscreen */}
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700 text-xs font-semibold text-amber-300">
                {selectedQuality}
              </div>

              {/* Settings Menu Button */}
              <div className="relative">
                <button
                  onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                  className="w-9 h-9 rounded-lg hover:bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                  title="Full Playback Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>

                {/* Extended Settings Menu */}
                {showSettingsMenu && (
                  <div className="absolute right-0 bottom-full mb-2 w-64 md:w-72 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl p-3 z-40 space-y-3 max-h-96 overflow-y-auto">
                    {/* Playback Speed */}
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Playback Speed
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0.75, 1, 1.25, 1.5, 2].map((spd) => (
                          <button
                            key={spd}
                            onClick={() => setSpeed(spd)}
                            className={`py-1 text-xs rounded font-medium ${
                              playbackSpeed === spd
                                ? 'bg-amber-500 text-black font-bold'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Select actual HLS audio renditions; catalogue language labels are metadata, not playable tracks. */}
                    <div className="border-t border-slate-800 pt-2">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Audio / Language</div>
                      {availableAudioTracks.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {availableAudioTracks.map(track => (
                            <button key={track.index} type="button"
                              onClick={() => {
                                if (hlsRef.current) {
                                  hlsRef.current.audioTrack = track.index;
                                  setActiveAudioIndex(track.index);
                                  setSelectedAudioTrack(track.name);
                                  triggerToast(`Audio: ${track.name}`);
                                }
                              }}
                              className={`px-3 py-2 rounded text-left text-xs ${activeAudioIndex === track.index ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
                              {track.name}{track.lang ? ` · ${track.lang}` : ''}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">No selectable audio tracks exposed by this stream. Embedded players manage their own audio settings.</p>
                      )}
                    </div>
                    {/* Audio Volume Booster */}
                    <div className="border-t border-slate-800 pt-2">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                        <span>Audio Boost (Gain)</span>
                        <span className="text-amber-400 font-mono">{Math.round(audioBoost * 100)}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[1.0, 1.25, 1.5, 2.0].map((b) => (
                          <button
                            key={b}
                            onClick={() => applyAudioBoost(b)}
                            className={`py-1 text-xs rounded font-medium ${
                              audioBoost === b
                                ? 'bg-amber-500 text-black font-bold'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {Math.round(b * 100)}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Aspect Ratio */}
                    <div className="border-t border-slate-800 pt-2">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Aspect Ratio
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        {[
                          { id: '16/9', label: '16:9 Standard' },
                          { id: '21/9', label: '21:9 Cinema' },
                          { id: 'cover', label: 'Fill Screen' },
                        ].map((ar) => (
                          <button
                            key={ar.id}
                            onClick={() => {
                              setAspectRatio(ar.id as any);
                              setShowSettingsMenu(false);
                              triggerToast(`Aspect ratio: ${ar.label}`);
                            }}
                            className={`py-1 rounded font-medium ${
                              aspectRatio === ar.id
                                ? 'bg-amber-500 text-black font-bold'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {ar.label.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Sleep Timer */}
                    <div className="border-t border-slate-800 pt-2">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                        <span>Sleep Timer</span>
                        {sleepTimerMinutes && (
                          <span className="text-amber-400 font-mono text-[10px]">Active ({sleepTimerMinutes}m)</span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[
                          { m: null, label: 'Off' },
                          { m: 15, label: '15m' },
                          { m: 30, label: '30m' },
                          { m: 60, label: '60m' },
                        ].map((item) => (
                          <button
                            key={item.label}
                            onClick={() => handleSetSleepTimer(item.m)}
                            className={`py-1 text-xs rounded font-medium ${
                              sleepTimerMinutes === item.m
                                ? 'bg-amber-500 text-black font-bold'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    </div>
                )}
              </div>

              {/* Theater Mode */}
              <button
                onClick={() => {
                  setTheaterMode(!theaterMode);
                  triggerToast(theaterMode ? 'Standard Cinema View' : 'Theater Mode Expanded');
                }}
                className="hidden md:flex w-9 h-9 rounded-lg hover:bg-slate-800/80 items-center justify-center text-slate-300 hover:text-white"
                title="Theater Mode"
              >
                {theaterMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="w-9 h-9 rounded-lg hover:bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white"
                title="Fullscreen (F)"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Dialog */}
      {showShortcutsModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-amber-400" />
                Player Keyboard Shortcuts
              </h4>
              <button onClick={() => setShowShortcutsModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-slate-300">
              <div className="flex justify-between"><span>Play / Pause</span><span className="font-mono text-amber-400">Space / K</span></div>
              <div className="flex justify-between"><span>Seek -10s / +10s</span><span className="font-mono text-amber-400">J / L or ← / →</span></div>
              <div className="flex justify-between"><span>Volume Up / Down</span><span className="font-mono text-amber-400">↑ / ↓</span></div>
              <div className="flex justify-between"><span>Mute Audio</span><span className="font-mono text-amber-400">M</span></div>
              <div className="flex justify-between"><span>Fullscreen</span><span className="font-mono text-amber-400">F</span></div>
              <div className="flex justify-between"><span>Theater Mode</span><span className="font-mono text-amber-400">T</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};