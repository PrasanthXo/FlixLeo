import { DesktopNativeSurface, desktopBridge } from './DesktopNativeSurface';
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, Play, Pause, RotateCcw, RotateCw, Maximize, Settings, Subtitles, Volume2, Upload, Minimize2, Maximize2 } from 'lucide-react';
import type { MediaItem, StreamMirror } from '../../types/stream';

const resumeKey = (m: MediaItem) => m.id + (m.playbackSeason !== undefined && m.playbackEpisode !== undefined ? ':s' + m.playbackSeason + 'e' + m.playbackEpisode : '');
type Props = { media: MediaItem; mirrors: StreamMirror[]; initialMirrorId?: string; minimizeSignal?: number; onClose: () => void; onProgressSaved?: () => void; onEpisodeEnded?: () => void };
type Track = { label: string; language: string; url: string };
const timeLabel = (n: number) => Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` : '0:00';
const qualitySort = (m: StreamMirror) => /4k|2160/i.test(m.quality) ? 2160 : parseInt(m.quality, 10) || 0;
const parseSrt = (text: string) => 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');

export const StremioNativePlayer: React.FC<Props> = ({ media, mirrors, initialMirrorId, minimizeSignal = 0, onClose, onProgressSaved, onEpisodeEnded }) => {
  const sorted = [...mirrors].sort((a, b) => qualitySort(b) - qualitySort(a));
  const [selected, setSelected] = useState(initialMirrorId || sorted[0]?.id || '');
  const [audioFix, setAudioFix] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerAnchor = useRef<HTMLDivElement>(null);
  const fullscreenFrame = useRef<HTMLDivElement>(null);
  const [desktopFullscreen, setDesktopFullscreen] = useState(false);
  useEffect(() => {
    const onFullscreen = () => setDesktopFullscreen(document.fullscreenElement === fullscreenFrame.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  const toggleDesktopFullscreen = async () => {
    if (!fullscreenFrame.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await fullscreenFrame.current.requestFullscreen();
    } catch { setError('Fullscreen could not be activated.'); }
  };
  const [docked, setDocked] = useState(false);
  useEffect(() => { if (minimizeSignal > 0) setDocked(true); }, [minimizeSignal]);
  useEffect(() => {
    const onScroll = () => {
      const anchor = playerAnchor.current;
      if (anchor && !docked && anchor.getBoundingClientRect().bottom < 0) setDocked(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [docked]);
  const hlsRef = useRef<Hls | null>(null);
  const shakaRef = useRef<any>(null);
  const uploadedRef = useRef<string | null>(null);
  const subtitleController = useRef<AbortController | null>(null);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioStatus, setAudioStatus] = useState<'loading' | 'available' | 'unavailable' | 'browser-limited'>('loading');
  const [subtitleError, setSubtitleError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [audio, setAudio] = useState(-1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subtitles, setSubtitles] = useState<Track[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState('');
  const [subtitleMode, setSubtitleMode] = useState<'auto' | 'on' | 'off'>('auto');
  const subtitlePreference = useRef<'auto' | 'manual' | 'off'>('auto');
  const subtitleSelection = useRef('');
  const selectAutomatically = (value: string) => {
    if (subtitlePreference.current !== 'auto' || subtitleSelection.current) return;
    subtitleSelection.current = value;
    setSelectedSubtitle(value);
    if (value.startsWith('hls-sub:') && hlsRef.current) {
      hlsRef.current.subtitleDisplay = true;
      hlsRef.current.subtitleTrack = Number(value.slice(8));
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const active = sorted.find(m => m.id === selected) || sorted[0];
  const desktopNative = Boolean(desktopBridge() && active && active.streamType !== 'embed-iframe');
  const [vlcNotice, setVlcNotice] = useState('');
  const openInVlc = () => {
    if (!active?.url || !/^https:\/\//i.test(active.url)) {
      setVlcNotice('This stream has no VLC-compatible HTTPS link.');
      return;
    }
    // Open only the original source, never the short-lived AAC conversion ticket.
    // Android Chrome can dispatch this intent to installed VLC.
    const source = active.url;
    const intent = 'intent://' + source.slice('https://'.length) +
      '#Intent;scheme=https;package=org.videolan.vlc;type=video/*;end';
    setVlcNotice('Opening VLC. If it does not open, check VLC is installed and the streaming source allows external playback.');
    window.location.href = intent;
  };
  const lastSave = useRef(0);
  const save = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.currentTime) || Date.now() - lastSave.current < 5000) return;
    lastSave.current = Date.now();
    try {
      const data = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
      const rows = Array.isArray(data) ? data : [];
      localStorage.setItem('flixleo_continue_watching', JSON.stringify([{ media, progress: video.currentTime, duration: video.duration || 0, updatedAt: Date.now() }, ...rows.filter((r: any) => !r?.media || resumeKey(r.media) !== resumeKey(media))].slice(0, 20)));
      onProgressSaved?.();
    } catch { /* storage is optional */ }
  };
  useEffect(() => {
    const controller = new AbortController();
    const id = media.id.match(/^(?:tmdb-|tv-)(\d+)$/)?.[1];
    if (!id) return;
    if (media.type === 'tv' && (media.playbackSeason === undefined || media.playbackEpisode === undefined)) return;
    setSubtitleLoading(true);
    const params = new URLSearchParams({ type: media.type === 'tv' ? 'series' : 'movie', tmdb: id });
    if (media.type === 'tv') {
      params.set('season', String(media.playbackSeason));
      params.set('episode', String(media.playbackEpisode));
    }
    fetch('/api/stremio/subtitles?' + params, { signal: controller.signal })
      .then(response => response.ok ? response.json() : { subtitles: [] })
      .then(data => {
        if (controller.signal.aborted) return;
        const online: Track[] = Array.isArray(data.subtitles) ? data.subtitles.filter(
          (t: any) => typeof t?.url === 'string' && typeof t?.language === 'string' && typeof t?.label === 'string'
        ) : [];
        setSubtitles(previous => [
          ...previous.filter(t => /^(?:hls-sub:|native-sub:|shaka-sub:|blob:)/.test(t.url)),
          ...online
        ]);
      })
      .catch(() => { /* Embedded and local subtitles remain available. */ })
      .finally(() => { if (!controller.signal.aborted) setSubtitleLoading(false); });
    return () => controller.abort();
  }, [media.id, media.type, media.playbackSeason, media.playbackEpisode]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || desktopNative) return;
    let disposed = false;
    video.muted = false;
    video.volume = 1;
    setMuted(false); setVolume(1);
    setError(''); setBuffering(true); setAudioTracks([]); setAudio(-1); setAudioAvailable(false); setAudioStatus('loading');
    setSubtitles(previous => previous.filter(t => !t.url.startsWith('hls-sub:') && !t.url.startsWith('native-sub:')));
    subtitlePreference.current = 'auto';
    subtitleSelection.current = '';
    setSubtitleMode('auto');
    setSelectedSubtitle('');
    const fail = () => { if (!disposed) { setBuffering(false); setError('Unable to play this stream in your browser.'); } };
    const url = audioFix && active.audioFixUrl ? active.audioFixUrl : active.url;
    const isAdaptive = !audioFix && (active.streamType === 'hls' || /\.m3u8(?:\?|$)|\.mpd(?:\?|$)/i.test(url));
    let shakaPlayer: any = null;
    const setupShaka = async () => {
      try {
        const module = await import('shaka-player');
        const shaka = (module as any).default || module;
        shaka.polyfill.installAll();
        if (disposed) return;
        if (!shaka.Player.isBrowserSupported()) throw new Error('Unsupported browser');
        shakaPlayer = new shaka.Player();
        await shakaPlayer.attach(video);
        if (disposed) { await shakaPlayer.destroy(); return; }
        shakaRef.current = shakaPlayer;
        shakaPlayer.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 3, bufferBehind: 20 }, abr: { enabled: true } });
        const refreshTracks = () => {
          if (disposed) return;
          const languages = shakaPlayer.getVariantTracks().filter((track: any) => track.audioId != null);
          const unique = languages.filter((track: any, i: number) => languages.findIndex((other: any) => other.audioId === track.audioId && other.language === track.language) === i);
          setAudioTracks(unique.map((track: any) => ({ id: track.id, name: [track.language, track.label].filter(Boolean).join(' · ') || 'Audio ' + track.id })));
          setAudioAvailable(unique.length > 1);
          setAudioStatus(unique.length > 1 ? 'available' : 'unavailable');
          const selected = shakaPlayer.getVariantTracks().find((track: any) => track.active);
          if (selected) setAudio(selected.id);
          const embedded = shakaPlayer.getTextTracks();
          setSubtitles(previous => [
            ...previous.filter(t => !t.url.startsWith('shaka-sub:')),
            ...embedded.map((track: any) => ({ url: 'shaka-sub:' + track.id, label: track.label || track.language || 'Embedded subtitles', language: track.language || 'und' }))
          ]);
          if (embedded.length && subtitlePreference.current === 'auto' && !subtitleSelection.current) {
            const preferred = embedded.find((track: any) => /^en(?:-|$)/i.test(track.language || '')) || embedded[0];
            shakaPlayer.selectTextTrack(preferred);
            shakaPlayer.setTextTrackVisibility(true);
            subtitleSelection.current = 'shaka-sub:' + preferred.id;
            setSelectedSubtitle(subtitleSelection.current);
          }
        };
        shakaPlayer.addEventListener('trackschanged', refreshTracks);
        shakaPlayer.addEventListener('adaptation', refreshTracks);
        shakaPlayer.addEventListener('error', () => { if (!disposed) fail(); });
        await shakaPlayer.load(url);
        if (!disposed) { refreshTracks(); void video.play().catch(() => setPlaying(false)); }
      } catch {
        if (disposed) return;
        if (shakaPlayer) { void shakaPlayer.destroy(); shakaPlayer = null; shakaRef.current = null; }
        // Keep the existing HLS/native playback if Shaka fails to initialize.
        if (active.streamType === 'hls' || /\.m3u8(?:\?|$)/i.test(url)) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
          else if (Hls.isSupported()) {
            const fallback = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 20 });
            hlsRef.current = fallback;
            fallback.loadSource(url); fallback.attachMedia(video);
          } else fail();
        } else video.src = url;
        void video.play().catch(() => setPlaying(false));
      }
    };
    if (isAdaptive) { void setupShaka(); }
    else if (active.streamType === 'hls' || /\.m3u8(?:\?|$)/i.test(url)) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
      else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 20, maxMaxBufferLength: 45, backBufferLength: 20, capLevelToPlayerSize: true, startFragPrefetch: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setAudioTracks(hls.audioTracks.map((t, i) => ({ id: i, name: t.name || t.lang || 'Track ' + (i + 1) })));
          if (hls.audioTracks.length && hls.audioTrack < 0) hls.audioTrack = 0;
          setAudio(hls.audioTrack);
          setAudioAvailable(hls.audioTracks.length > 1);
          setAudioStatus(hls.audioTracks.length > 1 ? 'available' : 'unavailable');
        });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          if (disposed) return;
          setAudioTracks(hls.audioTracks.map((t, i) => ({ id: i, name: [t.name, t.lang].filter(Boolean).join(' · ') || 'Track ' + (i + 1) })));
          setAudio(hls.audioTrack);
          setAudioAvailable(hls.audioTracks.length > 1);
          setAudioStatus(hls.audioTracks.length > 1 ? 'available' : 'unavailable');
        });
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          if (!disposed) setAudio(data.id);
        });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (disposed) return;
          // HLS subtitle renditions can be selected directly within hls.js.
          setSubtitles(previous => [
            ...previous.filter(t => !t.url.startsWith('hls-sub:')),
            ...hls.subtitleTracks.map((track, i) => ({ url: 'hls-sub:' + i, label: track.name || track.lang || 'Subtitle ' + (i + 1), language: track.lang || 'und' }))
          ]);
          if (hls.subtitleTracks.length && subtitlePreference.current === 'auto') {
            const preferred = hls.subtitleTracks.findIndex(track => /^en(?:-|$)/i.test(track.lang || ''));
            selectAutomatically('hls-sub:' + (preferred >= 0 ? preferred : 0));
          }
        });
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
        hls.loadSource(url); hls.attachMedia(video);
      } else fail();
    } else video.src = url;
    const loaded = () => {
      if (disposed) return;
      try {
        const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
        const match = Array.isArray(rows) ? rows.find((r: any) => r?.media && resumeKey(r.media) === resumeKey(media)) : null;
        const p = Number(match?.progress || 0);
        if (p > 5 && p < video.duration - 15) video.currentTime = p;
      } catch { /* ignore */ }
    };
    type NativeAudioTrackList = { length: number; [index: number]: { label?: string; language?: string; enabled: boolean }; addEventListener?: (name: string, listener: () => void) => void; removeEventListener?: (name: string, listener: () => void) => void };
    const nativeAudio = (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }).audioTracks;
    const detectNativeAudio = () => {
      if (disposed || hlsRef.current) return;
      const list = (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }).audioTracks;
      if (list && list.length) {
        setAudioTracks(Array.from({ length: list.length }, (_, i) => ({ id: i, name: [list[i].label, list[i].language].filter(Boolean).join(' · ') || 'Track ' + (i + 1) })));
        const selectedAudio = Array.from({ length: list.length }, (_, i) => i).find(i => list[i].enabled);
        if (selectedAudio === undefined) list[0].enabled = true;
        setAudio(selectedAudio ?? 0);
        setAudioAvailable(list.length > 1);
        setAudioStatus(list.length > 1 ? 'available' : 'unavailable');
      } else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        setAudioAvailable(false);
        setAudioStatus('browser-limited');
      }
    };
    nativeAudio?.addEventListener?.('addtrack', detectNativeAudio);
    nativeAudio?.addEventListener?.('removetrack', detectNativeAudio);
    nativeAudio?.addEventListener?.('change', detectNativeAudio);
    const detectEmbeddedSubtitles = () => {
      if (disposed) return;
      const tracks = Array.from(video.textTracks);
      const embedded = tracks.map((track, index) => ({ track, index }))
        .filter(({ track }) => (track.kind === 'subtitles' || track.kind === 'captions') && track.label !== 'Selected subtitles');
      setSubtitles(previous => [
        ...previous.filter(t => !t.url.startsWith('native-sub:')),
        ...embedded.map(({ track, index }) => ({
          url: 'native-sub:' + index,
          label: track.label || track.language || 'Embedded subtitle ' + (index + 1),
          language: track.language || 'und'
        }))
      ]);
      if (embedded.length && subtitlePreference.current === 'auto' && !subtitleSelection.current) {
        const preferred = embedded.find(({ track }) => /^en(?:-|$)/i.test(track.language || '')) || embedded[0];
        for (const track of tracks) track.mode = 'disabled';
        preferred.track.mode = 'showing';
        selectAutomatically('native-sub:' + preferred.index);
      }
    };
    video.addEventListener('loadedmetadata', detectEmbeddedSubtitles);
    video.textTracks.addEventListener('addtrack', detectEmbeddedSubtitles);
    video.addEventListener('loadedmetadata', loaded);
    video.addEventListener('loadedmetadata', detectNativeAudio);
    video.addEventListener('canplay', detectNativeAudio);
    video.addEventListener('error', fail);
    if (!isAdaptive) video.play().catch(() => setPlaying(false));
    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', detectEmbeddedSubtitles);
      video.textTracks.removeEventListener('addtrack', detectEmbeddedSubtitles);
      nativeAudio?.removeEventListener?.('addtrack', detectNativeAudio);
      nativeAudio?.removeEventListener?.('removetrack', detectNativeAudio);
      nativeAudio?.removeEventListener?.('change', detectNativeAudio);
      video.removeEventListener('canplay', detectNativeAudio);
      video.removeEventListener('loadedmetadata', loaded); video.removeEventListener('loadedmetadata', detectNativeAudio); video.removeEventListener('error', fail);
      hlsRef.current?.destroy(); hlsRef.current = null;
      if (shakaPlayer) { void shakaPlayer.destroy(); shakaPlayer = null; }
      shakaRef.current = null;
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [active?.id, active?.url, active?.audioFixUrl, audioFix, media.id]);
  const changeAudio = (id: number) => {
    if (shakaRef.current) {
      const track = shakaRef.current.getVariantTracks().find((t: any) => t.id === id);
      if (track) { shakaRef.current.configure({ abr: { enabled: false } }); shakaRef.current.selectVariantTrack(track, true); setAudio(id); }
      return;
    }
    if (hlsRef.current) { hlsRef.current.audioTrack = id; setAudio(id); return; }
    const native = (videoRef.current as (HTMLVideoElement & { audioTracks?: { length: number; [index: number]: { enabled: boolean } } }) | null)?.audioTracks;
    if (native && id >= 0 && id < native.length) {
      for (let i = 0; i < native.length; i++) native[i].enabled = i === id;
      setAudio(id);
    }
  };
  const selectSubtitle = async (url: string) => {
    subtitleController.current?.abort();
    setSubtitleError('');
    subtitlePreference.current = url ? 'manual' : 'off';
    setSubtitleMode(url ? 'on' : 'off');
    subtitleSelection.current = url;
    if (shakaRef.current) {
      const enabled = url.startsWith('shaka-sub:');
      const track = enabled ? shakaRef.current.getTextTracks().find((t: any) => String(t.id) === url.slice(10)) : null;
      if (track) shakaRef.current.selectTextTrack(track);
      shakaRef.current.setTextTrackVisibility(Boolean(track));
    }
    if (hlsRef.current) {
      hlsRef.current.subtitleDisplay = url.startsWith('hls-sub:');
      hlsRef.current.subtitleTrack = url.startsWith('hls-sub:') ? Number(url.slice(8)) : -1;
    }
    if (videoRef.current) for (let i = 0; i < videoRef.current.textTracks.length; i++) {
      videoRef.current.textTracks[i].mode = url === 'native-sub:' + i ? 'showing' : 'disabled';
    }
    if (!url || url.startsWith('hls-sub:') || url.startsWith('native-sub:') || url.startsWith('shaka-sub:') || url.startsWith('blob:')) {
      setSelectedSubtitle(url);
      return;
    }
    const controller = new AbortController();
    subtitleController.current = controller;
    setSubtitleLoading(true);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Subtitle download failed');
      const raw = await response.text();
      if (raw.length > 2000000) throw new Error('Subtitle too large');
      const isVtt = raw.trimStart().startsWith('WEBVTT') || /\.vtt(?:\?|$)/i.test(url);
      const converted = isVtt ? raw : parseSrt(raw);
      if (uploadedRef.current) URL.revokeObjectURL(uploadedRef.current);
      const objectUrl = URL.createObjectURL(new Blob([converted], { type: 'text/vtt' }));
      uploadedRef.current = objectUrl;
      subtitleSelection.current = objectUrl;
      setSelectedSubtitle(objectUrl);
    } catch {
      if (!controller.signal.aborted) setSubtitleError('Could not install online subtitles. Try another track or upload a file.');
    } finally { if (!controller.signal.aborted) setSubtitleLoading(false); }
  };
  const changeSubtitleMode = (mode: 'auto' | 'on' | 'off') => {
    setSubtitleMode(mode);
    subtitleController.current?.abort();
    if (mode === 'off') {
      void selectSubtitle('');
      return;
    }
    subtitlePreference.current = mode === 'auto' ? 'auto' : 'manual';
    subtitleSelection.current = '';
    const available = subtitles.filter(track => track.url.startsWith('native-sub:') || track.url.startsWith('hls-sub:') || track.url.startsWith('shaka-sub:'));
    const preferred = available.find(track => /^en(?:-|$)/i.test(track.language)) || available[0];
    if (preferred) {
      if (mode === 'auto') {
        selectAutomatically(preferred.url);
        if (preferred.url.startsWith('native-sub:') && videoRef.current) {
          const index = Number(preferred.url.slice('native-sub:'.length));
          Array.from(videoRef.current.textTracks).forEach((track, i) => { track.mode = i === index ? 'showing' : 'disabled'; });
        }
      } else void selectSubtitle(preferred.url);
    } else {
      setSelectedSubtitle('');
      if (hlsRef.current) { hlsRef.current.subtitleTrack = -1; hlsRef.current.subtitleDisplay = false; }
      if (shakaRef.current) shakaRef.current.setTextTrackVisibility(false);
      if (videoRef.current) Array.from(videoRef.current.textTracks).forEach(track => { track.mode = 'disabled'; });
    }
  };
  const uploadSubtitle = async (file: File | undefined) => {
    if (!file || !/\.(srt|vtt)$/i.test(file.name)) return;
    const text = await file.text();
    if (uploadedRef.current) URL.revokeObjectURL(uploadedRef.current);
    const url = URL.createObjectURL(new Blob([/\.srt$/i.test(file.name) ? parseSrt(text) : text], { type: 'text/vtt' }));
    uploadedRef.current = url;
    setSubtitles(old => [...old, { label: file.name, language: 'en', url }]);
    void selectSubtitle(url);
  };
  useEffect(() => () => { subtitleController.current?.abort(); if (uploadedRef.current) URL.revokeObjectURL(uploadedRef.current); }, []);
  return <section ref={playerAnchor} className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-700 bg-[#090b11] text-white">
    <div className="relative min-h-32 bg-cover bg-center p-4" style={{ backgroundImage: `linear-gradient(to top, #090b11, transparent), url("${media.backdropUrl}")` }}>
      <div className="mb-5 flex items-center justify-between gap-2">
        <button type="button" onClick={() => { save(); onClose(); }} className="rounded-full bg-slate-900/90 p-2" aria-label="Back"><ArrowLeft /></button>
        <button type="button" onClick={() => setDocked(true)} className="flex items-center gap-2 rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-white" aria-label="Minimize player"><Minimize2 size={16} /> Mini player</button>
      </div>
      <h2 className="text-lg font-bold">{media.title}</h2>
      <p className="text-xs text-slate-300">{media.year} · {media.duration}</p>
    </div>
    <div ref={fullscreenFrame} className={docked ? "fixed z-[80] right-3 bottom-24 md:bottom-8 w-[min(72vw,300px)] aspect-video overflow-hidden rounded-xl border border-amber-500/60 bg-black shadow-2xl" : "relative aspect-video bg-black"} style={desktopFullscreen ? { position: "fixed", inset: 0, top: 0, right: 0, bottom: 0, left: 0, width: "100vw", height: "100vh", maxWidth: "none", aspectRatio: "auto" } : undefined}>
      {<button type="button" className="absolute right-3 top-3 z-[60] rounded-lg bg-black/85 px-3 py-2 text-xs text-white border border-white/20" onClick={() => void toggleDesktopFullscreen()}>{desktopFullscreen ? "Exit fullscreen" : "⛶ Fullscreen"}</button>}
      {docked && <div className="absolute right-1 top-1 z-20 flex gap-1">
        <button type="button" aria-label="Expand mini player" onClick={() => { setDocked(false); playerAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="rounded bg-black/85 p-1 text-white"><Maximize2 size={16}/></button>
        <button type="button" aria-label="Close mini player" onClick={() => { save(); onClose(); }} className="rounded bg-black/85 px-2 text-white">×</button>
      </div>}
      {desktopNative && active ? <DesktopNativeSurface key={active.id} url={active.url} /> : <video ref={videoRef} playsInline preload="auto" className="h-full w-full object-contain"
        onPlay={() => { setPlaying(true); setBuffering(false); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={event => { setPosition(event.currentTarget.currentTime); setDuration(event.currentTarget.duration || 0); save(); }}
        onEnded={() => { setPlaying(false); save(); onEpisodeEnded?.(); }}>
        {selectedSubtitle && !selectedSubtitle.startsWith('hls-sub:') && !selectedSubtitle.startsWith('native-sub:') && !selectedSubtitle.startsWith('shaka-sub:') && <track key={selectedSubtitle} kind="subtitles" src={selectedSubtitle} srcLang="en" label="Selected subtitles" default />}
      </video>}
      {!desktopNative && buffering && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="h-11 w-11 animate-spin rounded-full border-4 border-slate-600 border-t-amber-400" /></div>}
      {error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg bg-black/80 p-3 text-xs text-amber-300">{error}</div>}
    </div>
    {desktopNative ? <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-black" onClick={() => void desktopBridge()?.commandNative('togglePause')}>Play / Pause</button>
        <button type="button" className="rounded-lg bg-slate-800 p-2" aria-label="Rewind 10 seconds" onClick={() => void desktopBridge()?.commandNative('seekBackward')}><RotateCcw size={18}/></button>
        <button type="button" className="rounded-lg bg-slate-800 p-2" aria-label="Forward 10 seconds" onClick={() => void desktopBridge()?.commandNative('seekForward')}><RotateCw size={18}/></button>
        <button type="button" className="rounded-lg bg-slate-800 p-2" onClick={() => void desktopBridge()?.commandNative('toggleMute')} aria-label="Mute or unmute"><Volume2 size={18}/></button>
        <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-xs" onClick={() => void desktopBridge()?.commandNative('toggleSubtitles')}>Subtitles on / off</button>
        <button type="button" className="ml-auto rounded-lg bg-slate-800 px-3 py-2 text-xs" onClick={() => void toggleDesktopFullscreen()}>{desktopFullscreen ? 'Exit fullscreen' : '⛶ Fullscreen'}</button>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="flixleo-native-volume" className="text-xs text-slate-300">Volume</label>
        <input id="flixleo-native-volume" type="range" min="0" max="100" value={Math.round(volume * 100)} className="w-40 accent-amber-500" onChange={e => { const next = Number(e.target.value); setVolume(next / 100); void desktopBridge()?.commandNative('setVolume', next); }} />
        <span className="text-xs text-slate-400">Use the controls on the video for seeking and track selection.</span>
      </div>
      <label className="block text-xs text-slate-300">Video quality / stream
        <select className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-white" value={active?.id || ''} onChange={e => setSelected(e.target.value)}>
          {sorted.map(m => <option key={m.id} value={m.id}>{m.quality} · {m.label}</option>)}
        </select>
      </label>
    </div> : <div className="space-y-3 p-4">
      <input type="range" min="0" max={Math.max(1, duration)} step="0.5" value={Math.min(position, Math.max(1, duration))} aria-label="Playback progress" className="w-full accent-amber-500" onChange={e => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); setPosition(Number(e.target.value)); }} />
      <div className="flex items-center gap-4">
        <button type="button" className="grid h-12 w-12 place-items-center rounded-full bg-amber-500 text-black" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</button>
        <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }} aria-label="Rewind ten seconds"><RotateCcw /></button>
        <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }} aria-label="Forward ten seconds"><RotateCw /></button>
        <span className="text-xs tabular-nums text-slate-300">{timeLabel(position)} / {timeLabel(duration)}</span>
        <button type="button" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} title={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => {
          const v = videoRef.current; if (!v) return;
          if (v.muted || v.volume === 0) { v.muted = false; v.volume = Math.max(v.volume, 0.7); }
          else v.muted = true;
          setMuted(v.muted); setVolume(v.volume);
        }}><Volume2 className={muted || volume === 0 ? 'text-amber-400' : ''}/></button>
        <input aria-label="Volume" title="Volume" type="range" min="0" max="1" step="0.05" value={volume}
          className="w-16 sm:w-24 accent-amber-500" onChange={e => { const v = videoRef.current; if (!v) return; v.volume = Number(e.target.value); v.muted = false; setVolume(v.volume); setMuted(false); }} />
        <button type="button" className="ml-auto" aria-label="Fullscreen" onClick={() => void toggleDesktopFullscreen()}><Maximize /></button>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-amber-500/50 bg-slate-800 px-3 py-2 text-xs font-bold text-amber-400">{active?.quality || 'Auto'}</span>
        <button type="button" className="rounded-lg bg-slate-800 p-2" onClick={() => setSettingsOpen(v => !v)} aria-label="Playback settings"><Settings /></button>
        <button type="button" className="rounded-lg bg-slate-800 p-2" onClick={() => setSettingsOpen(true)} aria-label="Subtitles"><Subtitles /></button>
      </div>
      {settingsOpen && <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
        <label className="block text-xs text-slate-300">Video quality / stream
          <select className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-white" value={active?.id || ''} onChange={e => { setAudioFix(false); setSelected(e.target.value); }}>
            {sorted.map(m => <option key={m.id} value={m.id}>{m.quality} · {m.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openInVlc}
            className="rounded-lg border border-orange-400/50 bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-200">
            Open in VLC (4K audio)
          </button>
        </div>
        {vlcNotice && <p role="status" className="text-xs text-slate-300">{vlcNotice}</p>}
        <p className="text-xs text-slate-400">VLC is an external app. Some streaming hosts may block playback outside FlixLeo.</p>
        {active?.audioFixUrl && <button type="button" onClick={() => setAudioFix(current => !current)}
          className="w-full rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-left text-xs font-semibold text-amber-300">
          {audioFix ? 'Use original audio' : 'Audio Fix · Convert audio to AAC (video unchanged)'}
        </button>}
        {audioFix && <p className="text-xs text-amber-300">Audio conversion may take time to start. Video codecs must still be browser-compatible.</p>}
        {!active?.audioFixUrl && /4k|2160/i.test(active?.quality || '') && <p className="text-xs text-amber-300">AAC Audio Fix is unavailable for this 4K source. The actual video host must support server-side access and be approved in Render.</p>}
        <label className="block text-xs text-slate-300"><span className="inline-flex items-center gap-1"><Volume2 size={14} /> Audio track</span>
          <select className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-white" value={audio} disabled={!audioAvailable} onChange={e => changeAudio(Number(e.target.value))}>
            {!audioAvailable && <option value={-1}>{audioStatus === 'loading' ? 'Detecting audio tracks…' : audioStatus === 'browser-limited' ? 'Audio tracks not exposed by this browser' : 'Original audio · no alternate track detected'}</option>}
            {audioTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-400">If picture plays without sound, try another Audio track above or choose another stream. AC-3, E-AC-3, DTS and some MKV audio are not supported in all browsers; FlixLeo cannot decode unsupported audio tracks in the browser.</p>
        {audioStatus === 'browser-limited' && <p className="text-xs text-slate-400">This browser cannot inspect or switch embedded audio tracks for this video. Multi-audio MP4/MKV files may require a compatible HLS stream or server-side remuxing.</p>}
        <div className="space-y-2">
          <span className="block text-xs text-slate-300">Subtitle display</span>
          <div role="group" aria-label="Subtitle display mode" className="grid grid-cols-3 gap-2">
            {(['auto', 'on', 'off'] as const).map(mode => <button key={mode} type="button" aria-pressed={subtitleMode === mode} onClick={() => changeSubtitleMode(mode)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${subtitleMode === mode ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}</button>)}
          </div>
          <p className="text-xs text-slate-400">{subtitleMode === 'auto' ? 'Automatically display supported embedded subtitles when detected.' : subtitleMode === 'on' ? 'Subtitles enabled when an available track is selected.' : 'Subtitles are turned off.'}</p>
        </div>
        <label className="block text-xs text-slate-300">Subtitle language / track {subtitleLoading ? '· Searching…' : ''}
          <select className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-white" value={selectedSubtitle} onChange={e => void selectSubtitle(e.target.value)}>
            <option value="">Off</option>
            {selectedSubtitle.startsWith('blob:') && <option value={selectedSubtitle}>Installed subtitle</option>}
            {subtitles.map(t => <option key={t.url} value={t.url}>{t.label} ({t.language})</option>)}
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs">
          <Upload size={16} /> Install subtitle (.srt or .vtt)
          <input className="sr-only" type="file" accept=".srt,.vtt" onChange={e => void uploadSubtitle(e.target.files?.[0])} />
        </label>
        {subtitleError && <p role="alert" className="text-xs text-amber-300">{subtitleError}</p>}
        {!subtitles.length && !subtitleLoading && <p className="text-xs text-slate-400">No automatic subtitle tracks found. Install a local subtitle file.</p>}
      </div>}
    </div>}
  </section>;
};
