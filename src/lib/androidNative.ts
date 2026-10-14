import type { MediaItem } from '../types/stream';

/** Android app marker added by our own WebView, never by mobile Chrome. */
export const isFlixLeoAndroid = () =>
  typeof navigator !== 'undefined' && /FlixLeoNative\/1\./i.test(navigator.userAgent);

export interface AndroidPlaybackResult {
  position: number;
  duration: number;
  ended: boolean;
  mirrorId: string;
}

const playbackKey = (m: MediaItem) =>
  m.id + (m.playbackSeason !== undefined && m.playbackEpisode !== undefined
    ? ':s' + m.playbackSeason + 'e' + m.playbackEpisode : '');

export function savedAndroidPosition(media: MediaItem): number {
  try {
    const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
    const match = Array.isArray(rows) ? rows.find((r: any) =>
      r?.media && playbackKey(r.media) === playbackKey(media)) : null;
    const seconds = Number(match?.progress ?? 0);
    return Number.isFinite(seconds) && seconds > 0 && seconds < 86400 ? seconds : 0;
  } catch { return 0; }
}

export function launchFlixLeoAndroidStream(url: string, title: string, mirrorId: string, resume: number): boolean {
  if (!isFlixLeoAndroid()) return false;
  try {
    const parsed = new URL(url);
    // Do not send javascript:, localhost or any insecure scheme to Android.
    if (parsed.protocol !== 'https:' || !parsed.hostname || /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) return false;
    const query = new URLSearchParams({
      url: parsed.href, title: title.slice(0, 120),
      mirror: mirrorId.slice(0, 160), resume: String(Math.max(0, resume))
    });
    window.location.href = 'flixleo-player://play?' + query.toString();
    return true;
  } catch { return false; }
}

export function saveFlixLeoAndroidProgress(media: MediaItem, mirrorId: string, result: AndroidPlaybackResult): void {
  if (!Number.isFinite(result.position) || result.position < 0) return;
  try {
    const rows = JSON.parse(localStorage.getItem('flixleo_continue_watching') || '[]');
    const existing = Array.isArray(rows) ? rows : [];
    // Leave the finished episode in history but reset its resume point.
    const progress = result.ended ? 0 : result.position;
    const entry = { media, mirrorId, progress, duration: result.duration || 0, updatedAt: Date.now() };
    localStorage.setItem('flixleo_continue_watching', JSON.stringify([
      entry, ...existing.filter((r: any) => !r?.media || playbackKey(r.media) !== playbackKey(media))
    ].slice(0, 20)));
  } catch { /* streaming works even when browser storage is unavailable */ }
}
