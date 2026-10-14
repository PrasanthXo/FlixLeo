import React, { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../../types/stream';

export type NativeTrack = { id:number; selected:boolean; language:string; title:string };
type DesktopBridge = {
  playNative: (url: string, position?: number) => Promise<{ ok: boolean; error?: string }>;
  positionNative: (bounds: number[]) => Promise<boolean>;
  stopNative: () => Promise<boolean>;
  playbackStatus?: () => Promise<{ready:boolean;position?:number}>;
  durationNative?: () => Promise<number>;
  isFullscreen?: () => Promise<boolean>;
  onFullscreenChanged?: (listener: (fullscreen: boolean) => void) => () => void;
  onNativeControlsVisible?: (listener: (visible: boolean) => void) => () => void;
  setControlsHeight?: (physicalPixels: number) => Promise<boolean>;
  tracksNative?: () => Promise<{ audio:NativeTrack[]; subtitles:NativeTrack[] }>;
  commandNative: (action: 'togglePause' | 'seekBackward' | 'seekForward' | 'toggleMute' | 'toggleSubtitles' | 'setVolume' | 'toggleFullscreen' | 'nextAudio' | 'nextSubtitle' | 'setAudioTrack' | 'setSubtitleTrack' | 'disableSubtitles' | 'seekTo' | 'setAspectRatio', value?: number | string) => Promise<boolean>;
};
export const fullLanguage = (code: string, title?: string): string => {
  const lang = (code || '').trim().replace(/_/g, '-').toLowerCase();
  const synonyms: Record<string, string> = { eng:'en', hin:'hi', tam:'ta', tel:'te', mal:'ml', kan:'kn', sin:'si', jpn:'ja', kor:'ko', spa:'es', fra:'fr', fre:'fr', ger:'de', deu:'de', und:'' };
  const normalized = synonyms[lang] ?? lang;
  let name = '';
  try { if (normalized) name = new Intl.DisplayNames(['en'], { type:'language' }).of(normalized) || ''; } catch {}
  return [name || title || (lang ? lang.toUpperCase() : 'Unknown language'), title && title !== name ? title : ''].filter(Boolean).join(' · ');
};
export const desktopBridge = (): DesktopBridge | undefined =>
  (window as Window & { flixleoDesktop?: DesktopBridge }).flixleoDesktop;

export function useDesktopWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let mounted = true;
    const unsubscribe = bridge.onFullscreenChanged?.(value => { if (mounted) setFullscreen(value); });
    void bridge.isFullscreen?.().then(value => { if (mounted) setFullscreen(Boolean(value)); }).catch(() => {});
    return () => { mounted = false; unsubscribe?.(); };
  }, []);
  return fullscreen;
}

export function useDesktopControlsVisible(fullscreen: boolean): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!fullscreen) { setVisible(true); return; }
    const off = desktopBridge()?.onNativeControlsVisible?.(setVisible);
    return () => off?.();
  }, [fullscreen]);
  // Hide the underlying catalogue's poster menus while the native Win32
  // fullscreen video is active. Those buttons otherwise bleed through the
  // reserved HTML control area as repeated vertical three-dot circles.
  useEffect(() => {
    document.body.classList.toggle('flixleo-native-fullscreen', fullscreen);
    return () => document.body.classList.remove('flixleo-native-fullscreen');
  }, [fullscreen]);
  // Hide the Chromium cursor too; mpv hides its own native cursor.
  // A class is used so interactive child elements cannot override it.
  useEffect(() => {
    document.documentElement.classList.toggle('flixleo-native-cursor-hidden', fullscreen && !visible);
    return () => document.documentElement.classList.remove('flixleo-native-cursor-hidden');
  }, [fullscreen, visible]);
  return visible;
}

/** Video remains inside the existing React big/mini player; the same mpv
 * process follows this element on dock/undock rather than restarting. */
export function DesktopNativeSurface({ url, media, mirrorId, onProgressSaved }: { url: string; media?: MediaItem; mirrorId?: string; onProgressSaved?: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    const el = surface.current;
    if (!bridge || !el || !/^https:\/\//i.test(url)) return;
    let active = true;
    setReady(false);
    const keyFor = (m: MediaItem) => m.id + (m.playbackSeason !== undefined && m.playbackEpisode !== undefined ? ':s' + m.playbackSeason + 'e' + m.playbackEpisode : '');
    let startAt = 0;
    try {
      if (media) {
        const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
        const previous = Array.isArray(rows) ? rows.find((row: any) => row?.media && keyFor(row.media) === keyFor(media)) : undefined;
        if (previous && (!mirrorId || previous.mirrorId === mirrorId)) startAt = Math.max(0, Number(previous.progress) || 0);
      }
    } catch {}
    let lastSaved = 0;
    const savePosition = (position: number) => {
      if (!media || !mirrorId || !Number.isFinite(position) || position < 1 || Date.now() - lastSaved < 4500) return;
      lastSaved = Date.now();
      try {
        const old = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
        const rows = Array.isArray(old) ? old : [];
        const entry = { media, mirrorId, progress: position, duration: 0, updatedAt: Date.now() };
        localStorage.setItem('flixleo_continue_watching', JSON.stringify([entry, ...rows.filter((row: any) => !row?.media || keyFor(row.media) !== keyFor(media))].slice(0, 20)));
        onProgressSaved?.();
      } catch {}
    };

    const statusTimer = window.setInterval(() => {
      if (!active || !bridge.playbackStatus) return;
      void bridge.playbackStatus().then(status => { if (active && status.ready) { setReady(true); if (typeof status.position === 'number') savePosition(status.position); } }).catch(() => {});
    }, 750);
    let last = '';
    const reposition = () => {
      if (!active || !surface.current) return;
      const rect = surface.current.getBoundingClientRect();
      const zoom = window.devicePixelRatio || 1;
      // Allow signed left/top: native Win32 child windows are clipped by their
      // parent. Clamping a scrolled-off video to (0,0) pins a huge video over
      // the Home page and prevents the mini-player from appearing properly.
      const bounds = [
        Math.round(rect.left * zoom),
        Math.round(rect.top * zoom),
        Math.max(1, Math.round(rect.width * zoom)),
        Math.max(1, Math.round(rect.height * zoom))
      ];
      const key = bounds.join(',');
      if (key !== last && bounds[2] > 0 && bounds[3] > 0) {
        last = key;
        void bridge.positionNative(bounds);
      }
    };
    void bridge.playNative(url, startAt).then(result => {
      if (!active) { void bridge.stopNative(); return; }
      if (!result.ok) window.alert(result.error || 'Native video unavailable');
      reposition();
    });
    const timer = window.setInterval(reposition, 120);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    reposition();
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(statusTimer);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      void bridge.stopNative();
    };
  }, [url, mirrorId, media?.id, media?.playbackSeason, media?.playbackEpisode]);
  return <div ref={surface} className="relative w-full h-full min-h-0 bg-black" aria-label="FlixLeo native Windows video surface">
    {!ready && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black text-sm text-slate-300 pointer-events-none">
      <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-amber-400" />
      <span>Loading video…</span>
    </div>}
  </div>;
}
