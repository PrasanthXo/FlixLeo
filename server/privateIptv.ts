import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

type PrivateChannel = { id: string; name: string; category: string; language: string; country: string; logo: string; url: string };
const channelMap = new Map<string, PrivateChannel>();
const mediaMap = new Map<string, { url: string; expires: number }>();
let cacheUntil = 0;
let loading: Promise<void> | null = null;
const CAP = 30000;
const PER_SOURCE_CAP = 1100;
const originList = () => {
  try {
    const parsed = JSON.parse(process.env.FLIXLEO_PRIVATE_IPTV_URLS_JSON || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v)).slice(0, 40) : [];
  } catch { return []; }
};
const safeExternal = (input: string) => {
  try {
    const u = new URL(input);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || h === '0.0.0.0') return false;
    if (isIP(h) === 4 && /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return false;
    if (isIP(h) === 6 && (/^::1$|^::$|^f[cd]|^fe[89ab]|^::ffff:(?:127|10|192\.168)/.test(h))) return false;
    return true;
  } catch { return false; }
};
async function fetchRemote(url: string, init: RequestInit = {}, streaming = false) {
  if (!safeExternal(url)) throw Error('Disallowed upstream');
  const controller = new AbortController();
  // For media, bound the connection setup but never abort an active live stream
  // merely because its playback lasts longer than the initial fetch timeout.
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    let response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw Error('Invalid redirect');
      const next = new URL(location, url).href;
      if (!safeExternal(next)) throw Error('Disallowed redirect');
      response = await fetch(next, { ...init, redirect: 'error', signal: controller.signal });
    }
    if (streaming) {
      clearTimeout(timeout);
    } else {
      // Non-streaming playlist fetches should still be bounded while reading the body.
      return response;
    }
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
function attr(info: string, key: string) {
  return (info.match(new RegExp('(?:^|\\s)' + key + '="([^"]*)"', 'i'))?.[1] || '').trim().slice(0, 120);
}
function isLive(info: string, url: string) {
  const group = attr(info, 'group-title').toLowerCase();
  if (/\b(vod|on.?demand|series|season|episode|catch.?up|adult|xxx)\b/.test(group)) return false;
  if (/(?:\/movie\/|\/series\/|\/vod\/)/i.test(url)) return false;
  if (/\.(?:mp4|mkv|avi|mov)(?:[?#]|$)/i.test(url)) return false;
  return true;
}
function category(info: string) {
  const group = attr(info, 'group-title').toLowerCase();
  if (/news|politics|weather|business/.test(group)) return 'News';
  if (/sport|cricket|football|soccer/.test(group)) return 'Sports';
  if (/music|radio/.test(group)) return 'Music';
  if (/kids|children|cartoon|animation/.test(group)) return 'Kids';
  if (/document|education|science|travel|nature/.test(group)) return 'Documentary';
  if (/religion|faith|spirit|devotion/.test(group)) return 'Religious';
  if (/entertain|general|variety|comedy|lifestyle/.test(group)) return 'Entertainment';
  return 'Other';
}
async function refresh() {
  if (Date.now() < cacheUntil) return;
  if (loading) return loading;
  loading = (async () => {
    const urls = originList();
    if (!urls.length) { channelMap.clear(); cacheUntil = Date.now() + 60_000; return; }
    const next = new Map<string, PrivateChannel>();
    const seen = new Set<string>();
    // Process each small batch immediately; never retain all remote playlists.
    for (let offset = 0; offset < urls.length && next.size < CAP; offset += 3) {
      const batch = await Promise.allSettled(urls.slice(offset, offset + 3).map(async source => {
        const res = await fetchRemote(source);
        if (!res.ok || Number(res.headers.get('content-length') || 0) > 15_000_000) throw Error('Playlist unavailable');
        const body = await res.text();
        if (body.length > 15_000_000 || !body.trimStart().startsWith('#EXTM3U')) throw Error('Not M3U');
        return body;
      }));
      for (const item of batch) {
        if (item.status !== 'fulfilled') continue;
        let info = '';
        let sourceCount = 0;
        for (const raw of item.value.split(/\r?\n/)) {
          const line = raw.trim();
          if (line.startsWith('#EXTINF:')) { info = line; continue; }
          if (!info || !line || line.startsWith('#')) continue;
          if (!safeExternal(line) || !isLive(info, line)) { info = ''; continue; }
          const name = (info.includes(',') ? info.slice(info.indexOf(',') + 1).trim() : '') || attr(info, 'tvg-name') || 'Live TV';
          const tvgId = attr(info, 'tvg-id');
          const genre = category(info);
          const country = attr(info, 'tvg-country');
          const language = attr(info, 'tvg-language') || 'Unknown';
          const logo = attr(info, 'tvg-logo');
          const key = (tvgId ? 'id:' + tvgId.toLowerCase() : 'url:' + line);
          info = '';
          if (seen.has(key)) continue;
          seen.add(key);
          const id = randomBytes(14).toString('hex');
          next.set(id, { id, name: name.slice(0, 120), url: line,
            category: genre, language, country,
            logo: logo.startsWith('https://') ? logo : '' });
          sourceCount++;
          if (next.size >= CAP || sourceCount >= PER_SOURCE_CAP) break;
        }
        if (next.size >= CAP) break;
      }
    }
    if (next.size || !channelMap.size) { channelMap.clear(); next.forEach((v,k) => channelMap.set(k,v)); }
    cacheUntil = Date.now() + 15 * 60_000;
  })();
  try { await loading; } finally { loading = null; }
}
function mediaToken(url: string) {
  const id = randomBytes(18).toString('hex');
  const now = Date.now();
  mediaMap.set(id, { url, expires: now + 60 * 60_000 });
  // Expire old tokens routinely, not only after storing 120,000 entries.
  if (mediaMap.size % 256 === 0 || mediaMap.size > 10000) {
    for (const [key, value] of mediaMap) {
      if (value.expires <= now) mediaMap.delete(key);
    }
  }
  // Hard cap prevents media-token accumulation during frequent HLS segment requests.
  while (mediaMap.size > 10000) {
    const oldest = mediaMap.keys().next().value;
    if (!oldest) break;
    mediaMap.delete(oldest);
  }
  return '/api/live/private/media/' + id;
}
// Backward-compatible catalog for Android versions that fetch the Plavio Live TV endpoint.
// Only opaque IDs and channel metadata leave the backend.
export async function legacyIptvCatalogs() {
  await refresh();
  const names = ['Sports', 'News', 'Entertainment', 'Movies & Series', 'Music', 'Kids', 'Documentary', 'Religious', 'Other'];
  const grouped = new Map<string, PrivateChannel[]>();
  for (const ch of channelMap.values()) {
    const group = names.includes(ch.category) ? ch.category : 'Other';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(ch);
  }
  return names.flatMap(name => {
    const channels = grouped.get(name) || [];
    if (!channels.length) return [];
    return [{
      id: 'flixleo-' + name.toLowerCase().replace(/[^a-z]+/g, '-'),
      type: 'channel' as const, name,
      items: channels.slice(0, 350).map(ch => ({
        id: 'flixlive_' + ch.id, type: 'channel' as const, name: ch.name,
        poster: ch.logo, description: '', genres: [name]
      }))
    }];
  });
}
export async function legacyIptvStream(id: string): Promise<string | null> {
  if (!/^flixlive_[a-f0-9]{28}$/.test(id)) return null;
  await refresh();
  const channel = channelMap.get(id.slice('flixlive_'.length));
  return channel ? mediaToken(channel.url) : null;
}

export function installPrivateIptv(app: Express) {
  app.get('/api/live/private/channels', async (_req: Request, res: Response) => {
    try {
      await refresh();
      res.setHeader('Cache-Control','no-store');
      res.json({ channels: [...channelMap.values()].map(({ url, ...rest }) => rest) });
    } catch { res.status(503).json({ channels: [], message: 'Private live TV sources temporarily unavailable' }); }
  });
  app.get('/api/live/private/channel/:id', async (req: Request, res: Response) => {
    try {
      await refresh();
      const channel = channelMap.get(req.params.id);
      if (!channel) return res.status(404).json({ message: 'Channel unavailable' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url: mediaToken(channel.url) });
    } catch { res.status(503).json({ message: 'Channel temporarily unavailable' }); }
  });
  app.get('/api/live/private/media/:token', async (req: Request, res: Response) => {
    const token = mediaMap.get(req.params.token);
    if (!token || token.expires < Date.now()) return res.sendStatus(404);
    try {
      const upstream = await fetchRemote(token.url, { headers: req.headers.range ? { Range: String(req.headers.range) } : {} }, true);
      if (!upstream.ok || !upstream.body) return res.sendStatus(502);
      const contentType = upstream.headers.get('content-type') || '';
      const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(new URL(upstream.url).pathname);
      res.setHeader('Cache-Control','no-store');
      if (isPlaylist) {
        const body = await upstream.text();
        if (body.length > 2_000_000 || !body.trimStart().startsWith('#EXTM3U')) return res.sendStatus(502);
        const rewritten = body.split(/\r?\n/).map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed[0] !== '#') {
            const uri = new URL(trimmed, upstream.url).href;
            return safeExternal(uri) ? mediaToken(uri) : '#unsupported-uri';
          }
          return line.replace(/URI="([^"]+)"/g, (_whole, path: string) => {
            const uri = new URL(path, upstream.url).href;
            return 'URI="' + (safeExternal(uri) ? mediaToken(uri) : '') + '"';
          });
        }).join('\n');
        res.type('application/vnd.apple.mpegurl').send(rewritten);
      } else {
        res.status(upstream.status);
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        const length = upstream.headers.get('content-length');
        if (length) res.setHeader('Content-Length', length);
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);
        res.setHeader('Accept-Ranges', 'bytes');
        const stream = Readable.fromWeb(upstream.body as any);
        // pipeline handles upstream socket/timeout errors instead of letting an
        // unhandled Readable 'error' terminate the entire Render Node process.
        await pipeline(stream, res);
      }
    } catch { if (!res.headersSent) res.sendStatus(502); else res.end(); }
  });
}
