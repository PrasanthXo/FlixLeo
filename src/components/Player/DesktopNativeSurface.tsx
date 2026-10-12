import React, { useEffect, useRef } from 'react';

type DesktopBridge = {
  playNative: (url: string) => Promise<{ ok: boolean; error?: string }>;
  positionNative: (bounds: number[]) => Promise<boolean>;
  stopNative: () => Promise<boolean>;
};
export const desktopBridge = (): DesktopBridge | undefined =>
  (window as Window & { flixleoDesktop?: DesktopBridge }).flixleoDesktop;

/** Video remains inside the existing React big/mini player; the same mpv
 * process follows this element on dock/undock rather than restarting. */
export function DesktopNativeSurface({ url }: { url: string }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    const el = surface.current;
    if (!bridge || !el || !/^https:\/\//i.test(url)) return;
    let active = true;
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
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      void bridge.stopNative();
    };
  }, [url]);
  return <div ref={surface} className="w-full h-full min-h-0 bg-black" aria-label="FlixLeo native Windows video surface" />;
}
