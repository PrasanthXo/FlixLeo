import React, { useEffect, useRef, useState } from 'react';

export type NativeTrack = { id:number; selected:boolean; language:string; title:string };
type DesktopBridge = {
  playNative: (url: string) => Promise<{ ok: boolean; error?: string }>;
  positionNative: (bounds: number[]) => Promise<boolean>;
  stopNative: () => Promise<boolean>;
  playbackStatus?: () => Promise<{ready:boolean}>;
  tracksNative?: () => Promise<{ audio:NativeTrack[]; subtitles:NativeTrack[] }>;
  commandNative: (action: 'togglePause' | 'seekBackward' | 'seekForward' | 'toggleMute' | 'toggleSubtitles' | 'setVolume' | 'toggleFullscreen' | 'nextAudio' | 'nextSubtitle' | 'setAudioTrack' | 'setSubtitleTrack', value?: number) => Promise<boolean>;
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

/** Video remains inside the existing React big/mini player; the same mpv
 * process follows this element on dock/undock rather than restarting. */
export function DesktopNativeSurface({ url }: { url: string }) {
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    const el = surface.current;
    if (!bridge || !el || !/^https:\/\//i.test(url)) return;
    let active = true;
    setReady(false);
    const statusTimer = window.setInterval(() => {
      if (!active || !bridge.playbackStatus) return;
      void bridge.playbackStatus().then(status => { if (active && status.ready) setReady(true); }).catch(() => {});
    }, 750);
    let last = '';
    const reposition = () => {
      if (!active || !surface.current) return;
      const rect = surface.current.getBoundingClientRect();
      const zoom = window.devicePixelRatio || 1;
      const bounds = [rect.left, rect.top, rect.width, rect.height].map(v => Math.max(0, Math.round(v * zoom)));
      const key = bounds.join(',');
      if (key !== last && bounds[2] > 0 && bounds[3] > 0) {
        last = key;
        void bridge.positionNative(bounds);
      }
    };
    void bridge.playNative(url).then(result => {
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
  }, [url]);
  return <div ref={surface} className="relative w-full h-full min-h-0 bg-black" aria-label="FlixLeo native Windows video surface">
    {!ready && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black text-sm text-slate-300 pointer-events-none">
      <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-amber-400" />
      <span>Loading video…</span>
    </div>}
  </div>;
}
