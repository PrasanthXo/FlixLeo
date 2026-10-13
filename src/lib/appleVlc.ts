// Apple web-browser VLC handoff. Native Android and desktop app bridges are separate.
export type AppleVlcTarget = 'ios' | 'mac';

export function getAppleVlcTarget(): AppleVlcTarget | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  const desktopBridge = (window as Window & { flixleoDesktop?: unknown }).flixleoDesktop;
  if (/FlixLeoNative\/1\.0/i.test(ua) || desktopBridge) return null;
  // iPadOS Safari often identifies itself as Macintosh.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh/i.test(ua)) return 'mac';
  return null;
}

export function getAppleVlcLaunchUrl(streamUrl: string, target: AppleVlcTarget): string | null {
  try {
    const url = new URL(streamUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (target === 'ios') {
      // VLC for iOS/iPadOS implements x-callback-url's /stream endpoint.
      return 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(url.href);
    }
    // VLC on macOS does not register vlc:// itself: a user-installed
    // VLC URL handler must be registered to forward this URL to VLC.
    return 'vlc://weblink?url=' + encodeURIComponent(url.href);
  } catch {
    return null;
  }
}
