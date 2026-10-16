import express, { Request, Response } from 'express';
import updateGateway from './server/updateGateway';
import nativeMobileApi from './server/nativeMobileApi';
import windowsDownload from './server/windowsDownload';
import landingRoutes, { serveAppLanding } from './server/landingRoutes';
import { installSubtitleGateway } from './server/subtitleGateway';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Native Continue Watching entries include poster, episode and playback metadata.
// Express's default JSON limit (100 KB) rejects larger sync requests with HTTP 413.
// Apply a bounded higher limit only to the authenticated native data endpoint.
app.use('/api/native/data', express.json({ limit: '2mb' }));
app.use(express.json());
app.use(updateGateway);
app.use(nativeMobileApi);
app.use(windowsDownload);
app.use(landingRoutes);

// Private FlixLeo admin API. Credentials must only be configured in Render.
// Never use the public anon key for privileged Supabase Auth operations.
app.get('/api/admin/users', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = (process.env.FLIXLEO_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!supabaseUrl || !secret || !adminEmail) return res.status(503).json({ error: 'Admin access is not configured.' });
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in first.' });
  try {
    const identityResponse = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: secret, authorization }
    });
    if (!identityResponse.ok) return res.status(401).json({ error: 'Session expired or invalid.' });
    const identity: any = await identityResponse.json();
    if (!identity?.email_confirmed_at || identity.email?.trim().toLowerCase() !== adminEmail) {
      return res.status(403).json({ error: 'This account is not authorized.' });
    }
    const pageParam = Number(req.query.page || 1);
    const page = Math.max(1, Math.min(10000, Number.isFinite(pageParam) ? Math.floor(pageParam) : 1));
    const usersRes = await fetch(supabaseUrl + '/auth/v1/admin/users?page=' + page + '&per_page=100', {
      headers: { apikey: secret, Authorization: 'Bearer ' + secret }
    });
    if (!usersRes.ok) return res.status(502).json({ error: 'Could not retrieve user records.' });
    const result: any = await usersRes.json();
    const users = Array.isArray(result.users) ? result.users : [];
    const ids = users.map((user: any) => user.id).filter(Boolean);
    let watchlistCounts: Record<string, number> = {};
    if (ids.length) {
      const rows = await fetch(supabaseUrl + '/rest/v1/flixleo_user_data?select=user_id,payload&user_id=in.(' + ids.join(',') + ')', {
        headers: { apikey: secret, Authorization: 'Bearer ' + secret }
      });
      if (rows.ok) {
        const data: any = await rows.json();
        if (Array.isArray(data)) for (const row of data) watchlistCounts[row.user_id] = Array.isArray(row.payload?.watchlist) ? row.payload.watchlist.length : 0;
      }
    }
    return res.json({
      page, total: Number(result.aud || result.total || 0) || null,
      countOnPage: users.length,
      hasMore: users.length === 100,
      users: users.map((user: any) => ({
        id: user.id, email: user.email || '', created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null,
        confirmed: Boolean(user.email_confirmed_at),
        watchlist_count: watchlistCounts[user.id] || 0
      }))
    });
  } catch {
    return res.status(502).json({ error: 'Admin data is temporarily unavailable.' });
  }
});


/**
 * Short-lived TV device authorization. Pairing is initiated on the TV, approved
 * on a signed-in phone, and redeemed once by the original TV only.
 * Magic links are generated server-side; Supabase service keys never reach browsers.
 */
const tvPairs = new Map<string, { secret: string; expires: number; consumed: boolean; tokenHash?: string; deviceId?: string }>();
const tvPairRequests = new Map<string, { count: number; resetAt: number }>();
function tvPairRateLimit(req: Request, res: Response, next: () => void) {
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const rate = tvPairRequests.get(ip);
  const item = !rate || rate.resetAt < now ? { count: 1, resetAt: now + 60_000 } : { ...rate, count: rate.count + 1 };
  tvPairRequests.set(ip, item);
  if (item.count > 30) { res.status(429).json({ error: 'Too many requests. Try again in one minute.' }); return; }
  next();
}
function cleanTvPairs() {
  const now = Date.now();
  for (const [id, pair] of tvPairs) if (pair.expires < now || pair.consumed) tvPairs.delete(id);
  for (const [ip, rate] of tvPairRequests) if (rate.resetAt < now) tvPairRequests.delete(ip);
}
app.post('/api/tv/pair', tvPairRateLimit, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  cleanTvPairs();
  if (tvPairs.size >= 500) return res.status(503).json({ error: 'TV pairing is busy. Retry shortly.' });
  const id = randomUUID();
  const secret = randomUUID() + randomUUID();
  tvPairs.set(id, { secret, expires: Date.now() + 5 * 60_000, consumed: false });
  return res.json({ id, secret, expiresIn: 300, url: 'https://flixleo.cyou/?tv_pair=' + encodeURIComponent(id) });
});
app.get('/api/tv/pair/:id', tvPairRateLimit, (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const pair = tvPairs.get(String(req.params.id));
  if (!pair || pair.expires < Date.now() || pair.consumed) return res.status(410).json({ status: 'expired' });
  if (req.get('x-tv-pair-secret') !== pair.secret) return res.status(403).json({ error: 'Invalid TV code.' });
  if (!pair.tokenHash) return res.json({ status: 'pending' });
  // Single-use redemption: a phone/another device cannot claim this TV session.
  pair.consumed = true;
  tvPairs.delete(String(req.params.id));
  return res.json({ status: 'approved', tokenHash: pair.tokenHash, deviceId: pair.deviceId });
});
app.post('/api/tv/pair/:id/approve', tvPairRateLimit, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const pair = tvPairs.get(String(req.params.id));
  if (!pair || pair.expires < Date.now() || pair.consumed) return res.status(410).json({ error: 'Pairing expired. Refresh the TV code.' });
  if (pair.tokenHash) return res.status(409).json({ error: 'TV pairing has already been approved.' });
  const bearer = String(req.headers.authorization || '');
  if (!bearer.startsWith('Bearer ') || bearer.length < 20) return res.status(401).json({ error: 'Sign in on your phone first.' });
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(new RegExp('/$'), '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'TV sign-in is not configured on this server.' });
  try {
    const userResponse = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: serviceKey, Authorization: bearer }
    });
    if (!userResponse.ok) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    const user: any = await userResponse.json();
    if (!user?.id || !user?.email || !user?.email_confirmed_at) return res.status(403).json({ error: 'Confirm your email before pairing a TV.' });
    const linkResponse = await fetch(supabaseUrl + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: user.email })
    });
    if (!linkResponse.ok) return res.status(502).json({ error: 'Could not authorize the TV. Retry.' });
    const link: any = await linkResponse.json();
    // GoTrue versions return the hash in different locations. Some return
    // only an action_link; its token query parameter is the verification hash.
    let tokenHash: string | undefined = link?.properties?.hashed_token || link?.hashed_token;
    if (!tokenHash && typeof link?.properties?.action_link === 'string') {
      try { tokenHash = new URL(link.properties.action_link).searchParams.get('token') || undefined; } catch {}
    }
    if (!tokenHash && typeof link?.action_link === 'string') {
      try { tokenHash = new URL(link.action_link).searchParams.get('token') || undefined; } catch {}
    }
    if (!tokenHash) {
      console.error('TV authorization: Supabase generate_link returned no verification token (keys:', Object.keys(link || {}).join(','), 'properties:', Object.keys(link?.properties || {}).join(','), ')');
      return res.status(502).json({ error: 'Supabase did not provide a TV login token. Please retry.' });
    }
    const deviceId = randomUUID();
    const saved = await fetch(supabaseUrl + '/rest/v1/flixleo_tv_devices', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ id: deviceId, user_id: user.id, label: 'FlixLeo TV', approved_at: new Date().toISOString() })
    });
    if (!saved.ok) {
      console.error('TV devices table is unavailable:', saved.status);
      return res.status(503).json({ error: 'TV device storage is not ready. Configure the TV devices table.' });
    }
    pair.deviceId = deviceId;
    pair.tokenHash = tokenHash;
    return res.json({ success: true });
  } catch {
    return res.status(502).json({ error: 'TV pairing service temporarily unavailable.' });
  }
});


function tvAdminConfig() {
  return { url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(new RegExp('/$'), ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
}
async function verifiedTvUser(req: Request) {
  const { url, key } = tvAdminConfig();
  if (!url || !key) return null;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  const response = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: auth } });
  if (!response.ok) return null;
  const user: any = await response.json();
  return user?.email_confirmed_at && user?.id ? user : null;
}
app.get('/api/tv/devices', tvPairRateLimit, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifiedTvUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in again.' });
    const { url, key } = tvAdminConfig();
    const response = await fetch(url + '/rest/v1/flixleo_tv_devices?user_id=eq.' + encodeURIComponent(user.id) + '&select=id,label,approved_at,last_seen_at,revoked_at&order=approved_at.desc', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!response.ok) return res.status(503).json({ error: 'TV device storage unavailable.' });
    const devices = await response.json();
    return res.json({ devices: Array.isArray(devices) ? devices : [] });
  } catch { return res.status(502).json({ error: 'Unable to load approved TVs.' }); }
});
app.post('/api/tv/devices/:id/revoke', tvPairRateLimit, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifiedTvUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in again.' });
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid device.' });
    const { url, key } = tvAdminConfig();
    const response = await fetch(url + '/rest/v1/flixleo_tv_devices?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(user.id), {
      method: 'PATCH',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() })
    });
    if (!response.ok) return res.status(503).json({ error: 'Could not revoke this TV.' });
    const rows: any = await response.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Device not found.' });
    return res.json({ success: true });
  } catch { return res.status(502).json({ error: 'Could not revoke this TV.' }); }
});
app.post('/api/tv/devices/:id/check', tvPairRateLimit, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifiedTvUser(req);
    if (!user) return res.status(401).json({ authorized: false });
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(403).json({ authorized: false });
    const { url, key } = tvAdminConfig();
    const response = await fetch(url + '/rest/v1/flixleo_tv_devices?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(user.id) + '&select=id,revoked_at&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!response.ok) return res.status(503).json({ error: 'TV authorization temporarily unavailable.' });
    const rows: any = await response.json();
    if (!rows?.length || rows[0].revoked_at) return res.status(403).json({ authorized: false });
    // Best-effort heartbeat, never block valid device access on a heartbeat failure.
    void fetch(url + '/rest/v1/flixleo_tv_devices?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() })
    }).catch(() => {});
    return res.json({ authorized: true });
  } catch { return res.status(502).json({ error: 'TV authorization check failed.' }); }
});

// API: PixelDrain File Info & Stream Resolver
app.get('/api/pixeldrain/info/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const cleanId = id.trim();

  try {
    const response = await fetch(`https://pixeldrain.com/api/file/${cleanId}/info`);
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `PixelDrain returned status ${response.status}`,
        id: cleanId,
        directUrl: `https://pixeldrain.com/api/file/${cleanId}`,
      });
    }

    const data = await response.json();
    return res.json({
      success: true,
      id: cleanId,
      name: data.name || `pixeldrain_${cleanId}.mp4`,
      size: data.size || 0,
      mimeType: data.mime_type || 'video/mp4',
      dateUpload: data.date_upload,
      views: data.views || 0,
      directUrl: `https://pixeldrain.com/api/file/${cleanId}`,
      downloadUrl: `https://pixeldrain.com/api/file/${cleanId}?download`,
      canStream: data.mime_type ? data.mime_type.startsWith('video/') || data.mime_type.startsWith('audio/') : true
    });
  } catch {
    return res.status(502).json({
      success: false,
      id: cleanId,
      message: 'Pixeldrain file information could not be verified.'
    });
  }
});

// API: Universal Stream & Hub Link Resolver
app.post('/api/resolve', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, message: 'URL is required' });
  }

  const trimmed = url.trim();

  // 1. PixelDrain detection
  const pixeldrainMatch = trimmed.match(/(?:pixeldrain\.com\/(?:u|api\/file)\/|^)([a-zA-Z0-9_-]{6,16})/);
  if (pixeldrainMatch && (trimmed.includes('pixeldrain.com') || trimmed.length <= 16)) {
    const fileId = pixeldrainMatch[1];
    return res.json({
      success: true,
      source: 'pixeldrain',
      name: `PixelDrain Stream (${fileId})`,
      fileId,
      streamType: 'direct-video',
      streamUrl: `https://pixeldrain.com/api/file/${fileId}`,
      downloadUrl: `https://pixeldrain.com/api/file/${fileId}?download`,
      embedUrl: `https://pixeldrain.com/u/${fileId}`,
      quality: '1080p Original',
      features: ['Direct Stream', 'Resume Support', 'High-Speed CDN']
    });
  }

  // 2. TMDB Direct Movie / Show resolver
  const tmdbMatch = trimmed.match(/(?:themoviedb\.org\/movie\/|^tmdb:?|^id:?)(\d+)/i);
  if (tmdbMatch) {
    const tmdbId = tmdbMatch[1];
    return res.json({
      success: true,
      source: 'custom',
      name: `TMDB Feature Cinema Stream (#${tmdbId})`,
      streamType: 'embed-iframe',
      streamUrl: `https://vidlink.pro/movie/${tmdbId}`,
      embedUrl: `https://vidlink.pro/movie/${tmdbId}`,
      quality: '4K UHD / 1080p Full Movie',
      features: ['Full Playback (No 14m Limit)', 'Multi-Server Embed', 'Dolby Atmos & Subtitles']
    });
  }

  // 3. Regional Cinema Stream detection
  if (trimmed.includes('einthusan.tv') || trimmed.includes('einthusan') || trimmed.includes('regional')) {
    let mediaUrl: URL;
    try { mediaUrl = new URL(trimmed); } catch {
      return res.status(400).json({ success: false, message: 'A valid video URL is required.' });
    }
    const hls = /[.]m3u8$/i.test(mediaUrl.pathname);
    if (!hls && !/[.](mp4|webm|m4v|mov)$/i.test(mediaUrl.pathname)) {
      return res.status(422).json({ success: false, source: 'einthusan', pageUrl: mediaUrl.href, message: 'This is a web page, not a playable video file. A matching authorized direct video URL is required.' });
    }
    return res.json({ success: true, source: 'einthusan', name: 'External Video', streamType: hls ? 'hls' : 'direct-video', streamUrl: mediaUrl.href, quality: 'Source quality (unverified)' });
  }

  // 4. FastStream Link detection
  if (trimmed.includes('fsl') || trimmed.includes('faststream') || trimmed.includes('hubcloud') || trimmed.includes('filepress')) {
    let mediaUrl: URL;
    try { mediaUrl = new URL(trimmed); } catch {
      return res.status(400).json({ success: false, message: 'A valid video URL is required.' });
    }
    const hls = /[.]m3u8$/i.test(mediaUrl.pathname);
    if (!hls && !/[.](mp4|webm|m4v|mov)$/i.test(mediaUrl.pathname)) {
      return res.status(422).json({ success: false, source: 'fsl', pageUrl: mediaUrl.href, message: 'This is a web page, not a playable video file. A matching authorized direct video URL is required.' });
    }
    return res.json({ success: true, source: 'fsl', name: 'External Video', streamType: hls ? 'hls' : 'direct-video', streamUrl: mediaUrl.href, quality: 'Source quality (unverified)' });
  }

  // 5. 4KHDHub links: only accept an actual direct media URL.
  // A listing/page URL is not a stream; never substitute an unrelated film.
  if (/4khdhub|hdhub4u|hdhub/i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
    } catch {
      return res.status(400).json({ success: false, source: '4khdhub', message: 'Enter a valid HTTP(S) URL.' });
    }

    if (!/[.](mp4|m3u8|webm|m4v)(?:$|[?#])/i.test(parsed.pathname + parsed.search + parsed.hash)) {
      return res.status(422).json({
        success: false,
        source: '4khdhub',
        message: 'This is a web page, not a playable media link. Provide a direct, authorized MP4 or HLS URL.',
        pageUrl: parsed.toString()
      });
    }

    return res.json({
      success: true,
      source: '4khdhub',
      name: 'External Video Stream',
      streamType: /[.]m3u8(?:$|[?#])/i.test(parsed.pathname + parsed.search) ? 'hls' : 'direct-video',
      streamUrl: parsed.toString(),
      quality: 'Source quality (unverified)',
      features: ['Direct media URL']
    });
  }

  // 6. Never substitute a demo film for an unknown link.
  let direct: URL;
  try {
    direct = new URL(trimmed);
    if (!['https:', 'http:'].includes(direct.protocol) || direct.username || direct.password) throw new Error('Unsupported URL');
  } catch {
    return res.status(400).json({ success: false, message: 'Provide a valid HTTP(S) video URL.' });
  }
  const isHls = /[.]m3u8$/i.test(direct.pathname);
  if (!isHls && !/[.](mp4|m4v|webm|mov)$/i.test(direct.pathname)) {
    return res.status(422).json({
      success: false,
      message: 'This page is not a direct playable video. Provide a title-specific MP4, WebM or HLS link.',
      pageUrl: direct.href
    });
  }
  return res.json({
    success: true, source: 'custom', name: 'External Video',
    streamType: isHls ? 'hls' : 'direct-video',
    streamUrl: direct.href, quality: 'Source quality (unverified)',
    features: ['Direct URL', 'No unrelated fallback movie']
  });
});

// TMDB Service imports
import {
  fetchFromTmdb,
  transformTmdbMovie,
  transformTmdbTvShow,
  CURATED_TMDB_MOVIES,
  CURATED_TMDB_SERIES
} from './server/tmdbService';

// Same-origin poster delivery for legacy smart-TV browsers that cannot load
// image.tmdb.org directly. Never proxy arbitrary URLs.
app.get('/api/tv/artwork/:size/:filename', async (req: Request, res: Response) => {
  const size = String(req.params.size || '');
  const filename = String(req.params.filename || '');
  if (!/^(w185|w342|w500|w780|original)$/.test(size) || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    return res.status(400).end();
  }
  try {
    const imageResponse = await fetch('https://image.tmdb.org/t/p/' + size + '/' + filename, {
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*' },
      signal: AbortSignal.timeout(12000)
    });
    if (!imageResponse.ok || !imageResponse.body) return res.status(502).end();
    const type = imageResponse.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return res.status(502).end();
    const bytes = await imageResponse.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(Buffer.from(bytes));
  } catch { return res.status(502).end(); }
});

// API: TMDB Configuration Status
app.get('/api/tmdb/status', (_req: Request, res: Response) => {
  const apiKey = process.env.TMDB_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey !== 'MY_TMDB_API_KEY');
  res.json({
    configured: isConfigured,
    message: isConfigured
      ? 'TMDB API key connected. Live streaming catalogs active.'
      : 'Using curated TMDB offline catalogs. Set TMDB_API_KEY in environment to unlock live search and entire TMDB database.'
  });
});

// API: TMDB Trending Movies
app.get('/api/tmdb/trending', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/trending/movie/day', { page });
    
    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbMovie(m));
      return res.json({ success: true, isLive: true, items, page: tmdbData.page, totalPages: tmdbData.total_pages });
    }

    // Curated fallback
    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items, page: 1, totalPages: 1 });
  } catch (err: any) {
    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB Popular Movies
app.get('/api/tmdb/popular', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/movie/popular', { page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbMovie(m));
      return res.json({ success: true, isLive: true, items, page: tmdbData.page, totalPages: tmdbData.total_pages });
    }

    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB Top Rated
app.get('/api/tmdb/top_rated', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/movie/top_rated', { page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbMovie(m));
      return res.json({ success: true, isLive: true, items });
    }

    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    const items = CURATED_TMDB_MOVIES.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB South Asian / Einthusan Cinema (Hindi, Tamil, Telugu, Malayalam, Kannada)
app.get('/api/tmdb/indian', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/discover/movie', {
      with_original_language: 'hi|ta|te|ml|kn',
      sort_by: 'popularity.desc',
      page
    });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbMovie(m));
      return res.json({ success: true, isLive: true, items });
    }

    const filtered = CURATED_TMDB_MOVIES.filter(m => ['te', 'hi', 'ta'].includes(m.original_language));
    const items = filtered.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    const filtered = CURATED_TMDB_MOVIES.filter(m => ['te', 'hi', 'ta'].includes(m.original_language));
    const items = filtered.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// Dedicated South Indian cinema feed. Resolve each language separately so a
// failed or empty response cannot suppress all of the other languages.
app.get('/api/tmdb/south-indian', async (req: Request, res: Response) => {
  const page = Math.min(10, Math.max(1, Number(req.query.page) || 1));
  const languages = ['ta', 'te', 'ml', 'kn'];
  const results = await Promise.allSettled(languages.map(language =>
    fetchFromTmdb('/discover/movie', {
      with_original_language: language,
      sort_by: 'popularity.desc',
      page: String(page)
    })
  ));
  const movies = new Map<string, any>();
  for (const result of results) {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value?.results)) continue;
    for (const movie of result.value.results) {
      if (movie?.id && languages.includes(movie.original_language) && !movies.has(String(movie.id))) {
        movies.set(String(movie.id), movie);
      }
    }
  }
  if (!movies.size) {
    for (const movie of CURATED_TMDB_MOVIES) {
      if (languages.includes(movie.original_language) && movie.id) movies.set(String(movie.id), movie);
    }
  }
  // Round-robin language buckets to prevent the most popular language
  // from dominating the mixed South Indian cinema row.
  const buckets = languages.map(language => [...movies.values()]
    .filter(movie => movie.original_language === language)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)));
  const mixed: any[] = [];
  const maxLength = Math.max(0, ...buckets.map(bucket => bucket.length));
  for (let index = 0; index < maxLength; index++) {
    for (const bucket of buckets) {
      if (bucket[index]) mixed.push(bucket[index]);
    }
  }
  const items = mixed.map(movie => transformTmdbMovie(movie));
  return res.json({ success: true, isLive: results.some(result =>
    result.status === 'fulfilled' && Array.isArray(result.value?.results) && result.value.results.length > 0
  ), items, page });
});

// Stage 2 mobile Home discovery: independent feeds for each requested row.
// In-memory cache limits calls to TMDB when many users visit the Home page.
const homeCollectionsCache: { time: number; value: Record<string, any[]> | null } = { time: 0, value: null };
app.get('/api/tmdb/home-collections', async (_req: Request, res: Response) => {
  if (homeCollectionsCache.value && Date.now() - homeCollectionsCache.time < 15 * 60 * 1000) {
    return res.json({ success: true, collections: homeCollectionsCache.value, cached: true });
  }
  const movieGenres: Record<string,string> = {
    Action:'28', 'Sci-Fi':'878', Thriller:'53', Comedy:'35', Drama:'18',
    Romance:'10749', Horror:'27', Adventure:'12', Fantasy:'14', Mystery:'9648',
    Crime:'80', Animation:'16', Family:'10751', Documentary:'99', War:'10752',
    History:'36', Music:'10402'
  };
  const tvGenres: Record<string,string> = {
    Action:'10759','Sci-Fi':'10765',Thriller:'9648',Comedy:'35',Drama:'18',
    Romance:'18',Horror:'10765',Adventure:'10759',Fantasy:'10765',
    Mystery:'9648',Crime:'80',Animation:'16',Family:'10751',Documentary:'99'
  };
  const languages: Record<string,string> = {
    Tamil:'ta',English:'en',Hindi:'hi',Sinhala:'si',Telugu:'te',
    Malayalam:'ml',Kannada:'kn',Korean:'ko',Japanese:'ja'
  };
  // TMDB watch-provider IDs, shown as *discovery metadata*, not a promise of streams.
  const providers: Record<string,string> = {
    Netflix:'8', 'Amazon Prime Video':'9', 'Disney Plus':'337',
    'Apple TV':'350'
  };
  const requests: Array<{key:string; endpoint:string; params:Record<string,string>; tv?:boolean}> = [
    ...Object.entries(movieGenres).map(([key,id]) => ({key:'genre:'+key,endpoint:'/discover/movie',params:{with_genres:id}})),
    ...Object.entries(tvGenres).map(([key,id]) => ({key:'seriesGenre:'+key,endpoint:'/discover/tv',params:{with_genres:id},tv:true})),
    ...Object.entries(languages).map(([key,code]) => ({key:'language:'+key,endpoint:'/discover/movie',params:{with_original_language:code}})),
    {key:'anime:movies',endpoint:'/discover/movie',params:{with_genres:'16',with_original_language:'ja'}},
    {key:'anime:series',endpoint:'/discover/tv',params:{with_genres:'16',with_original_language:'ja'},tv:true},
    // All-language titles discoverable by provider in the indicated region.
    ...([
      {name:'STARZ',id:'43',region:'US'},
      {name:'ZEE5',id:'232',region:'IN'}
    ]).flatMap(provider => [
      {key:'allProviderMovie:'+provider.name,endpoint:'/discover/movie',
       params:{with_watch_providers:provider.id,watch_region:provider.region}},
      {key:'allProviderSeries:'+provider.name,endpoint:'/discover/tv',
       params:{with_watch_providers:provider.id,watch_region:provider.region},tv:true}
    ]),
    ...Object.entries(providers).flatMap(([key,id]) => [
      {key:'providerMovie:'+key,endpoint:'/discover/movie',params:{with_watch_providers:id,watch_region:'US'}},
      {key:'providerSeries:'+key,endpoint:'/discover/tv',params:{with_watch_providers:id,watch_region:'US'},tv:true}
    ])
  ];
  const fetched = await Promise.allSettled(requests.map(({endpoint,params}) =>
    fetchFromTmdb(endpoint,{...params,sort_by:'popularity.desc',page:'1'})
  ));
  const collections: Record<string, any[]> = {};
  fetched.forEach((result,i) => {
    const raw = result.status === 'fulfilled' && Array.isArray(result.value?.results) ? result.value.results : [];
    collections[requests[i].key] = raw.filter((item:any) => item?.id)
      .map((item:any) => requests[i].tv ? transformTmdbTvShow(item) : transformTmdbMovie(item));
  });
  homeCollectionsCache.value = collections;
  homeCollectionsCache.time = Date.now();
  return res.json({ success: true, collections });
});

// API: TMDB Live Search
app.get('/api/tmdb/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  if (!query) {
    return res.json({ success: true, items: [] });
  }

  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/search/movie', { query, page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results
        .filter((m: any) => m.poster_path || m.backdrop_path)
        .map((m: any) => transformTmdbMovie(m));
      return res.json({ success: true, isLive: true, items });
    }

    // Local search filter in curated
    const qLower = query.toLowerCase();
    const matches = CURATED_TMDB_MOVIES.filter(m => m.title.toLowerCase().includes(qLower));
    const items = matches.map(m => transformTmdbMovie(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    return res.json({ success: false, error: err.message, items: [] });
  }
});

// API: TMDB Trending TV Series
app.get('/api/tmdb/tv/trending', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/trending/tv/day', { page });
    
    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbTvShow(m));
      return res.json({ success: true, isLive: true, items, page: tmdbData.page, totalPages: tmdbData.total_pages });
    }

    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items, page: 1, totalPages: 1 });
  } catch (err: any) {
    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB Popular TV Series
app.get('/api/tmdb/tv/popular', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/tv/popular', { page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbTvShow(m));
      return res.json({ success: true, isLive: true, items });
    }

    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB Top Rated TV Series
app.get('/api/tmdb/tv/top_rated', async (req: Request, res: Response) => {
  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/tv/top_rated', { page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results.map((m: any) => transformTmdbTvShow(m));
      return res.json({ success: true, isLive: true, items });
    }

    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    const items = CURATED_TMDB_SERIES.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items, error: err.message });
  }
});

// API: TMDB TV Search
app.get('/api/tmdb/tv/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  if (!query) {
    return res.json({ success: true, items: [] });
  }

  try {
    const page = (req.query.page as string) || '1';
    const tmdbData = await fetchFromTmdb('/search/tv', { query, page });

    if (tmdbData && Array.isArray(tmdbData.results)) {
      const items = tmdbData.results
        .filter((m: any) => m.poster_path || m.backdrop_path)
        .map((m: any) => transformTmdbTvShow(m));
      return res.json({ success: true, isLive: true, items });
    }

    const qLower = query.toLowerCase();
    const matches = CURATED_TMDB_SERIES.filter(m => m.title.toLowerCase().includes(qLower));
    const items = matches.map(m => transformTmdbTvShow(m));
    return res.json({ success: true, isLive: false, items });
  } catch (err: any) {
    return res.json({ success: false, error: err.message, items: [] });
  }
});

// API: TMDB TV Series Details
app.get('/api/tmdb/tv/:id', async (req: Request, res: Response) => {
  const cleanId = req.params.id.replace('tv-', '');
  try {
    const tmdbData = await fetchFromTmdb(`/tv/${cleanId}`, {
      append_to_response: 'credits,videos'
    });

    if (tmdbData) {
      const item = transformTmdbTvShow(tmdbData);
      return res.json({ success: true, item });
    }

    const found = CURATED_TMDB_SERIES.find(m => m.id.toString() === cleanId);
    if (found) {
      return res.json({ success: true, item: transformTmdbTvShow(found) });
    }

    return res.status(404).json({ success: false, message: 'TV Series not found' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// TMDB season and episode metadata for the existing TV details modal.
app.get('/api/tmdb/details/tv/:id', async (req: Request, res: Response) => {
  const cleanId = String(req.params.id).replace(/^(tv-|tmdb-)/, '');
  if (!/^[0-9]+$/.test(cleanId)) return res.status(400).json({ success: false, message: 'Invalid series ID' });
  try {
    const details = await fetchFromTmdb(`/tv/${cleanId}`, { append_to_response: 'credits' });
    if (!details) return res.status(503).json({ success: false, message: 'TMDB is not configured' });
    const item = transformTmdbTvShow(details);
    const seasons = await Promise.all((details.seasons || [])
      .filter((season: any) => season.season_number >= 0 && season.episode_count > 0)
      .map(async (season: any) => {
        try {
          const data = await fetchFromTmdb(`/tv/${cleanId}/season/${season.season_number}`);
          return {
            number: season.season_number,
            episodes: (data?.episodes || []).map((episode: any) => {
              const number = episode.episode_number;
              const seriesNumber = season.season_number;
              const base = item.mirrors.filter((mirror: any) => mirror.streamType === 'embed-iframe');
              const mirrors = base.map((mirror: any) => ({
                ...mirror,
                id: `${mirror.id}-s${seriesNumber}e${number}`,
                label: mirror.label.replace(/S01E01/g, `S${String(seriesNumber).padStart(2,'0')}E${String(number).padStart(2,'0')}`),
                url: mirror.url.replace(/\/1\/1(?=\/|[?#]|$)/, `/${seriesNumber}/${number}`)
              }));
              return {
                id: `s${seriesNumber}e${number}`,
                number,
                title: episode.name || `Episode ${number}`,
                duration: episode.runtime ? `${episode.runtime}m` : 'Duration unavailable',
                airDate: /^\d{4}-\d{2}-\d{2}$/.test(episode.air_date || '') ? episode.air_date : null,
                mirrors
              };
            })
          };
        } catch {
          return { number: season.season_number, episodes: [] };
        }
      }));
    item.seasons = seasons;
    return res.json({ success: true, item });
  } catch (err: any) {
    return res.status(502).json({ success: false, message: 'Could not load TMDB episodes' });
  }
});

// API: TMDB Movie Details
app.get('/api/tmdb/movie/:id', async (req: Request, res: Response) => {
  const cleanId = req.params.id.replace('tmdb-', '');
  try {
    const tmdbData = await fetchFromTmdb(`/movie/${cleanId}`, {
      append_to_response: 'credits,videos'
    });

    if (tmdbData) {
      const item = transformTmdbMovie(tmdbData);
      return res.json({ success: true, item });
    }

    const found = CURATED_TMDB_MOVIES.find(m => m.id.toString() === cleanId);
    if (found) {
      return res.json({ success: true, item: transformTmdbMovie(found) });
    }

    return res.status(404).json({ success: false, message: 'Movie not found' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


/**
 * Optional Stremio protocol integration. Server-operator configured HTTPS add-ons only.
 * This endpoint deliberately excludes torrents, magnets, embeds and off-site page links:
 * browsers can only use direct, CORS-enabled HLS or video sources.
 */
// Audio-only compatibility mode: never re-encode video. Only operate on HTTPS
// stream URLs from completed Stremio discovery and explicitly allowed media hosts.
const audioFixSessions = new Map<string, { url: string; expires: number }>();
let activeAudioFixes = 0;
// Pixeldrain's documented file API is a known direct-video origin. FSL/FSLV2 hosts
// must be explicitly configured to avoid routing arbitrary websites through FFmpeg.
const audioFixHosts = new Set(['pixeldrain.com', ...(process.env.FLIXLEO_AUDIO_FIX_HOSTS || '').split(',')].map(x => x.trim().toLowerCase()).filter(Boolean));
function audioFixTicket(raw: string): string | undefined {
  if (!ffmpegPath || !audioFixHosts.size) return;
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !audioFixHosts.has(url.hostname.toLowerCase()) || url.port) return;
  const ticket = randomUUID();
  audioFixSessions.set(ticket, { url: url.href, expires: Date.now() + 10 * 60_000 });
  if (audioFixSessions.size > 300) {
    for (const [key, entry] of audioFixSessions) if (entry.expires < Date.now()) audioFixSessions.delete(key);
    while (audioFixSessions.size > 300) audioFixSessions.delete(audioFixSessions.keys().next().value!);
  }
  return '/api/stremio/audio-fix/' + ticket;
}
app.get('/api/stremio/audio-fix/:ticket', (req: Request, res: Response) => {
  const record = audioFixSessions.get(req.params.ticket);
  if (!record || record.expires < Date.now()) return res.status(404).send('Audio fix link expired. Reload servers.');
  if (activeAudioFixes >= 2) return res.status(503).send('Audio conversion is busy. Try again soon.');
  if (!ffmpegPath) return res.status(503).send('Audio conversion unavailable.');
  activeAudioFixes++;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
    '-protocol_whitelist', 'file,https,tls,tcp,crypto', '-i', record.url,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ];
  const process = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let done = false;
  const timeout = setTimeout(() => process.kill('SIGKILL'), 2 * 60 * 60_000);
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    activeAudioFixes--;
  };
  process.stdout.pipe(res);
  process.stderr.on('data', () => { /* Never disclose origin URLs in error logs. */ });
  process.on('error', () => { cleanup(); if (!res.headersSent) res.status(502).end('Audio conversion failed'); else res.end(); });
  process.on('close', () => { cleanup(); if (!res.writableEnded) res.end(); });
  res.on('close', () => { if (!done) process.kill('SIGKILL'); });
});

// Avoid repeatedly hitting providers that temporarily refuse Render requests.
// This cache is server-local and automatically expires.
const stremioProviderCooldown = new Map<string, number>();



const IPTV_PLAYLISTS = [
  { url: 'https://iptv-org.github.io/iptv/countries/lk.m3u', fallbackLanguage: 'Unknown', fallbackCountry: 'LK' },
  { url: 'https://iptv-org.github.io/iptv/languages/tam.m3u', fallbackLanguage: 'Tamil', fallbackCountry: '' },
  { url: 'https://iptv-org.github.io/iptv/index.m3u', fallbackLanguage: 'Unknown', fallbackCountry: '' },
  { url: 'https://tivimate.viulk.xyz/channels.m3u', fallbackLanguage: 'Unknown', fallbackCountry: '' }
] as const;
type IptvChannel = { id: string; name: string; logo: string; category: string; language: string; country: string; tvgId: string; url: string; alternateUrls?: string[] };
let iptvCache: { until: number; channels: IptvChannel[] } | null = null;
let iptvPending: Promise<IptvChannel[]> | null = null;
function iptvAttribute(line: string, key: string): string {
  const pattern = new RegExp('(?:^|\\s)' + key + '="([^"]*)"', 'i');
  return (line.match(pattern)?.[1] || '').trim().slice(0, 160);
}
function iptvHttps(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
async function iptvFetchPlaylist(url: string, fallbackLanguage: string, fallbackCountry: string): Promise<IptvChannel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 25_000_000) throw Error('Playlist unavailable');
    const body = await response.text();
    if (body.length > 25_000_000 || !body.trimStart().startsWith('#EXTM3U')) throw Error('Invalid playlist');
    const channels: IptvChannel[] = [];
    let info = '';
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF:')) { info = line; continue; }
      if (!info || !line || line.startsWith('#')) continue;
      const streamUrl = iptvHttps(line);
      if (streamUrl) {
        const name = ((info.includes(',') ? info.slice(info.indexOf(',') + 1).trim() : '') || iptvAttribute(info, 'tvg-name') || 'Live Channel').slice(0, 120);
        const category = iptvAttribute(info, 'group-title') || 'Other Channels';
        const language = iptvAttribute(info, 'tvg-language') || fallbackLanguage;
        const tvgId = iptvAttribute(info, 'tvg-id');
        const country = iptvAttribute(info, 'tvg-country') || (/(?:^|[.])lk(?:[.]|$)/i.test(tvgId) ? 'LK' : fallbackCountry);
        channels.push({ id: '', name, logo: iptvHttps(iptvAttribute(info, 'tvg-logo')),
          category, language, country, tvgId, url: streamUrl });
      }
      info = '';
      if (channels.length >= 30000) break;
    }
    return channels;
  } finally { clearTimeout(timeout); }
}
async function iptvGetChannels(): Promise<IptvChannel[]> {
  if (iptvCache && iptvCache.until > Date.now()) return iptvCache.channels;
  if (iptvPending) return iptvPending;
  iptvPending = (async () => {
    const result = await Promise.allSettled(IPTV_PLAYLISTS.map(p => iptvFetchPlaylist(p.url, p.fallbackLanguage, p.fallbackCountry)));
    const seenUrls = new Set<string>();
    const identified = new Map<string, IptvChannel>();
    const channels: IptvChannel[] = [];
    for (const response of result) {
      if (response.status !== 'fulfilled') continue;
      for (const channel of response.value) {
        const urlKey = channel.url.replace(/#.*$/, '');
        if (seenUrls.has(urlKey)) continue;
        seenUrls.add(urlKey);
        const idKey = channel.tvgId.toLowerCase();
        const nameKey = channel.name.toLowerCase()
          .replace(/\([^)]*(?:\d{3,4}p|hd|sd|fhd|4k)[^)]*\)/gi, '')
          .replace(/\b(?:hd|sd|fhd|4k|1080p|720p|480p|360p)\b/gi, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const identity = idKey ? 'id:' + idKey : nameKey.length >= 4
          ? 'name:' + nameKey + '|' + (channel.country || channel.language).toLowerCase() : '';
        const existing = identity ? identified.get(identity) : undefined;
        if (existing) {
          // Retain distinct compatible HTTPS alternatives for the same channel.
          const urls = existing.alternateUrls ||= [];
          if (existing.url !== channel.url && !urls.includes(channel.url) && urls.length < 5) urls.push(channel.url);
          continue;
        }
        const saved = { ...channel, id: String(channels.length) };
        channels.push(saved);
        if (identity) identified.set(identity, saved);
      }
    }
    if (!channels.length) throw Error('No playlists available');
    iptvCache = { until: Date.now() + 15 * 60_000, channels };
    return channels;
  })();
  try { return await iptvPending; } finally { iptvPending = null; }
}
app.get('/api/live/tamil/channels', async (_req: Request, res: Response) => {
  try {
    const channels = await iptvGetChannels();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ channels });
  } catch {
    if (iptvCache?.channels.length) return res.json({ channels: iptvCache.channels, stale: true });
    res.status(503).json({ channels: [], message: 'Live TV playlists temporarily unavailable.' });
  }
});

const PLAVIOHD_BASE = 'https://plaviohd.vercel.app';
// PlavioHD is an additive built-in provider; existing Render add-ons remain intact.
// Preserve the actual grouping announced by PlavioHD's Stremio manifest.
type PlavioLiveItem = { id: string; type: 'tv' | 'channel'; name: string; poster: string; description: string; genres: string[] };
type PlavioLiveCatalog = { id: string; type: 'tv' | 'channel'; name: string; items: PlavioLiveItem[] };
let cachedPlavioChannels: { expires: number; catalogs: PlavioLiveCatalog[] } | null = null;
async function fetchPlavioJson(route: string, timeoutMs = 14000): Promise<any> {
  // Retry transient network/5xx failures once. Each attempt has its own abort deadline.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(PLAVIOHD_BASE + route, {
        headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error('PlavioHD returned HTTP ' + response.status);
        if (response.status < 500 || attempt === 1) throw error;
        continue;
      }
      if (Number(response.headers.get('content-length') || 0) > 1024 * 1024) throw new Error('Response too large');
      const raw = await response.text();
      if (raw.length > 1024 * 1024) throw new Error('Response too large');
      return JSON.parse(raw);
    } catch (error) {
      if (attempt === 1) throw error;
    } finally { clearTimeout(timeout); }
  }
  throw new Error('PlavioHD unavailable');
}
function plavioSafePoster(candidate: unknown): string {
  if (typeof candidate !== 'string') return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
        url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return '';
    return url.href;
  } catch { return ''; }
}
// Preserve the last verified catalog during short provider outages (up to 30 minutes).
function serveStalePlavioCatalog(res: Response): boolean {
  if (!cachedPlavioChannels || cachedPlavioChannels.expires + 30 * 60_000 < Date.now() ||
      cachedPlavioChannels.catalogs.length === 0) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ provider: 'PlavioHD', catalogs: cachedPlavioChannels.catalogs, stale: true });
  return true;
}
// Only known catalog IDs are exposed; this is not an arbitrary upstream URL proxy.

app.get('/api/stremio/plavio/live/catalog', async (_req: Request, res: Response) => {
  if (cachedPlavioChannels && cachedPlavioChannels.expires > Date.now()) {
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.json({ provider: 'PlavioHD', catalogs: cachedPlavioChannels.catalogs });
  }
  try {
    // Read the real channel categories from the addon. Never invent category IDs.
    const manifest = await fetchPlavioJson('/manifest.json', 6000);
    const announced = Array.isArray(manifest?.catalogs) ? manifest.catalogs : [];
    const channelCatalogs: { type: 'tv' | 'channel'; id: string; name: string }[] = announced.flatMap((entry: any) => {
      if ((entry?.type !== 'tv' && entry?.type !== 'channel') ||
          typeof entry.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(entry.id) ||
          (Array.isArray(entry.extraRequired) && entry.extraRequired.length > 0) ||
          (Array.isArray(entry.extra) && entry.extra.some((e: any) => e?.isRequired))) return [];
      return [{ type: entry.type, id: entry.id,
        name: String(entry.name || entry.id).trim().slice(0, 80) || 'Live TV' }];
    }).slice(0, 12);
    if (!channelCatalogs.length) {
      if (serveStalePlavioCatalog(res)) return;
      return res.json({
      provider: 'PlavioHD', catalogs: [],
      message: 'This add-on does not currently advertise a Live TV channel catalog.'
    });
    }
    // Maintain manifest order; one failed channel type should not remove other types.
    const requests = await Promise.allSettled(channelCatalogs.map(async catalog =>
      fetchPlavioJson('/catalog/' + catalog.type + '/' + encodeURIComponent(catalog.id) + '.json', 12000)
    ));
    const catalogs: PlavioLiveCatalog[] = channelCatalogs.map((catalog, index) => {
      const response = requests[index];
      const entries = response.status === 'fulfilled' && Array.isArray(response.value?.metas)
        ? response.value.metas.slice(0, 120) : [];
      const seen = new Set<string>();
      const items: PlavioLiveItem[] = entries.flatMap((entry: any) => {
        const id = typeof entry?.id === 'string' ? entry.id : '';
        if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(id) || seen.has(id)) return [];
        seen.add(id);
        return [{
          id, type: catalog.type, name: String(entry.name || 'Live channel').slice(0, 120),
          poster: plavioSafePoster(entry.poster || entry.logo),
          description: String(entry.description || '').slice(0, 240),
          genres: Array.isArray(entry.genres)
            ? entry.genres.filter((genre: unknown) => typeof genre === 'string').slice(0, 5).map((genre: string) => genre.slice(0, 32))
            : []
        }];
      });
      return { ...catalog, items };
    }).filter(catalog => catalog.items.length > 0);
    if (!catalogs.length && serveStalePlavioCatalog(res)) return;
    if (catalogs.length) cachedPlavioChannels = { expires: Date.now() + 60_000, catalogs };
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.json({ provider: 'PlavioHD', catalogs,
      ...(!catalogs.length ? { message: 'No Live TV channels are currently available.' } : {}) });
  } catch (error) {
    console.warn('PlavioHD live catalog unavailable:', error instanceof Error ? error.message : 'unknown provider failure');
    if (serveStalePlavioCatalog(res)) return;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Live channels temporarily unavailable', catalogs: [] });
  }
});
app.get('/api/stremio/plavio/live/streams', async (req: Request, res: Response) => {
  const id = String(req.query.id || '');
  const type = String(req.query.type || 'tv');
  if ((type !== 'tv' && type !== 'channel') || !/^[a-zA-Z0-9._:-]{1,180}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  try {
    const payload = await fetchPlavioJson('/stream/' + type + '/' + encodeURIComponent(id) + '.json');
    const raw = Array.isArray(payload?.streams) ? payload.streams.slice(0, 40) : [];
    const streams = raw.flatMap((entry: any) => {
      if (typeof entry?.url !== 'string') return [];
      let url: URL;
      try { url = new URL(entry.url); } catch { return []; }
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
          url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return [];
      const pathname = url.pathname.toLowerCase();
      const mime = String(entry.mimeType || '').toLowerCase();
      const hls = pathname.endsWith('.m3u8') || mime.includes('mpegurl') ||
        /\.m3u8(?:[?&]|$)/i.test(url.search);
      const dash = pathname.endsWith('.mpd') || mime.includes('dash+xml');
      const direct = ['.mp4', '.webm', '.m4v', '.mov'].some(ext => pathname.endsWith(ext)) || mime.startsWith('video/');
      const segment = pathname.split('/').pop() || '';
      const extensionless = !segment.includes('.') && !/(embed|watch|view|page|player|login|redirect)/i.test(pathname);
      if (!hls && !dash && !direct && !extensionless) return [];
      const rawLabel = String(entry.title || entry.name || 'Live stream');
      const label = rawLabel.split('https://')[0].trim().slice(0, 100);
      const details = String(entry.title || '') + ' ' + String(entry.name || '');
      const quality = /(?:2160p|4k|uhd)/i.test(details) ? '4K'
        : /1080p/i.test(details) ? '1080p' : /720p/i.test(details) ? '720p'
        : /480p/i.test(details) ? '480p' : 'Auto';
      return [{ name: label || 'Live stream', url: url.href, quality,
        streamType: hls ? 'hls' : 'direct-video' }]; // DASH URLs use Shaka in the live player.
    });
    const unique = [...new Map(streams.map((s: { url: string }) => [s.url, s])).values()];
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ provider: 'PlavioHD', streams: unique });
  } catch {
    return res.status(502).json({ error: 'Live stream lookup temporarily unavailable', streams: [] });
  }
});
app.get('/api/stremio/streams', async (req: Request, res: Response) => {
  // Some mobile link handlers encode the ampersand into the type value.
  // Parse it safely without weakening title/episode validation.
  const rawQuery = req.originalUrl.split('?').slice(1).join('?');
  const normalizedQuery = rawQuery.replace(/%26/gi, '&').replace(/%3D/gi, '=');
  const parsedQuery = new URLSearchParams(normalizedQuery);
  const type = parsedQuery.get('type') ?? req.query.type;
  const tmdb = String(parsedQuery.get('tmdb') ?? req.query.tmdb ?? '').trim();
  const season = Number(parsedQuery.get('season') ?? req.query.season);
  const episode = Number(parsedQuery.get('episode') ?? req.query.episode);
  if ((type !== 'movie' && type !== 'series') || !/^\d{1,12}$/.test(tmdb) ||
      (type === 'series' && (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1))) {
    return res.status(400).json({ error: 'Invalid title or episode', received: { type: String(type || ''), tmdb, season: Number.isFinite(season) ? season : null, episode: Number.isFinite(episode) ? episode : null } });
  }
  // Use the requested configured HDHub add-on path, rather than a stale
  // unconfigured HDHub root URL from Render's environment. Keep other add-ons.
  const hdhubConfigured = 'https://hdhub.thevolecitor.qzz.io/eyJ0b3Jib3giOiJ1bnNldCIsInF1YWxpdGllcyI6IjIxNjBwLDEwODBwLDcyMHAiLCJzb3J0IjoiZGVzYyIsImNhdGFsb2dzIjoiIn0';
  const envAddons = (process.env.STREMIO_ADDON_URLS || '').split(',').map(x => x.trim()).filter(Boolean)
    .filter(value => {
      try { return new URL(value).hostname !== 'hdhub.thevolecitor.qzz.io'; }
      catch { return false; }
    });
  const configured = [...new Set([hdhubConfigured, ...envAddons, PLAVIOHD_BASE])].slice(0, 6);
  if (!configured.length) return res.json({ streams: [], configured: false, message: 'No add-ons configured on Render' });
  const providers = configured.flatMap(value => {
    try {
      const u = new URL(value.replace(/\/manifest\.json$/, '').replace(/\/$/, ''));
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.') ||
          /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return [];
      return [{ base: u.toString().replace(/\/$/, ''), hostname: u.hostname }];
    } catch { return []; }
  });
  let imdb: string;
  try {
    const external = await fetchFromTmdb('/' + (type === 'movie' ? 'movie' : 'tv') + '/' + tmdb + '/external_ids');
    if (typeof external?.imdb_id !== 'string' || !/^tt\d{5,12}$/.test(external.imdb_id)) {
      return res.json({ streams: [], configured: true, message: 'TMDB IMDb lookup failed; check TMDB_API_KEY' });
    }
    imdb = external.imdb_id;
  } catch { return res.json({ streams: [], configured: true, message: 'TMDB IMDb lookup unavailable' }); }
  const target = type === 'movie' ? imdb : imdb + ':' + season + ':' + episode;
  const diagnostics: { provider: string; status: string; returned?: number; compatible?: number }[] = [];
  const results = await Promise.all(providers.map(async provider => {
    const cooldownUntil = stremioProviderCooldown.get(provider.hostname) || 0;
    if (cooldownUntil > Date.now()) {
      diagnostics.push({ provider: provider.hostname, status: 'Access denied (HTTP 403); retry later' });
      return [];
    }
    if (cooldownUntil) stremioProviderCooldown.delete(provider.hostname);
    const controller = new AbortController();
    // WebStreamr can need longer to aggregate multiple upstream sources.
    const providerTimeoutMs = provider.hostname === 'plaviohd.vercel.app' || provider.hostname.includes('webstreamr') || provider.hostname.includes('baby-beamup.club') ? 15000 : 7500;
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    try {
      const response = await fetch(provider.base + '/stream/' + type + '/' + encodeURIComponent(target) + '.json',
        { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if (response.status === 403) {
          stremioProviderCooldown.set(provider.hostname, Date.now() + 2 * 60 * 1000);
          diagnostics.push({ provider: provider.hostname, status: 'Access denied (HTTP 403); provider must allow server requests' });
        } else {
          diagnostics.push({ provider: provider.hostname, status: 'HTTP ' + response.status });
        }
        return [];
      }
      if (Number(response.headers.get('content-length') || 0) > 1048576) {
        diagnostics.push({ provider: provider.hostname, status: 'Response too large' }); return [];
      }
      const raw = await response.text();
      if (raw.length > 1048576) { diagnostics.push({ provider: provider.hostname, status: 'Response too large' }); return []; }
      const payload = JSON.parse(raw);
      const entries = Array.isArray(payload.streams) ? payload.streams.slice(0, 50) : [];
      const streams = entries.flatMap((stream: any) => {
        if (typeof stream.url !== 'string') return [];
        let url: URL;
        try { url = new URL(stream.url); } catch { return []; }
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
            /^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return [];
        const pathname = url.pathname.toLowerCase();
        const declaredMime = String(stream.mimeType || stream.mime_type || '').toLowerCase();
        const hls = /\.m3u8$/i.test(pathname) || /^(application\/(vnd\.apple\.mpegurl|x-mpegurl))/.test(declaredMime);
        const video = /\.(mp4|webm|m4v|mov)$/i.test(pathname) || /^video\/(mp4|webm|quicktime)/.test(declaredMime);
        // Stremio add-ons often use signed, extensionless HTTPS playback endpoints.
        // Such links can be tried in the video element, but never as iframes or top-level redirects.
        // Keep known web pages, playlists other than HLS, and downloadable archives out.
        const lastSegment = pathname.split('/').pop() || '';
        const extensionless = !lastSegment.includes('.') && !/\/((embed|watch|view|page|player|login|redirect))(\/|$)/i.test(pathname);
        if (!hls && !video && !extensionless) return [];
        const label = String(stream.title || '').slice(0, 160);
        const qualityText = [stream.name, stream.title, stream.description, stream.filename]
          .filter(x => typeof x === 'string').join(' ')
          // "4khdhub" is a provider name, not evidence of 4K resolution.
          .replace(/4khdhub/gi, '');
        const quality = /(?:^|[^a-z0-9])(?:2160p|4k|uhd)(?![a-z0-9])/i.test(qualityText) ? '4K'
          : /(?:^|[^a-z0-9])1080p(?![a-z0-9])/i.test(qualityText) ? '1080p'
          : /(?:^|[^a-z0-9])720p(?![a-z0-9])/i.test(qualityText) ? '720p'
          : /(?:^|[^a-z0-9])480p(?![a-z0-9])/i.test(qualityText) ? '480p'
          : /(?:^|[^a-z0-9])360p(?![a-z0-9])/i.test(qualityText) ? '360p' : 'Auto';
        const sizeFromBytes = Number(stream.size || stream.fileSizeBytes || 0);
        const sizeText = [stream.title, stream.name, stream.description, stream.filename, stream.fileSize]
          .filter((s: unknown): s is string => typeof s === 'string')
          .join(' ').match(/(?:^|[^\d])([0-9]+(?:\.[0-9]+)?)\s*(GiB|GB|MiB|MB|TiB|TB)\b/i);
        const fileSize = Number.isFinite(sizeFromBytes) && sizeFromBytes > 0
          ? (sizeFromBytes >= 1073741824 ? (sizeFromBytes / 1073741824).toFixed(2) + ' GB' : (sizeFromBytes / 1048576).toFixed(1) + ' MB')
          : sizeText ? sizeText[1] + ' ' + sizeText[2].toUpperCase() : undefined;
        return [{ provider: provider.hostname, name: String(stream.name || 'Add-on stream').slice(0, 80),
          title: label, url: url.toString(), quality, fileSize, streamType: hls ? 'hls' : 'direct-video',
          audioFixUrl: !hls && quality === '4K' ? audioFixTicket(url.toString()) : undefined }];
      });
      const kinds = { httpsUrls: entries.filter((e: any) => typeof e.url === 'string' && e.url.startsWith('https://')).length,
        torrents: entries.filter((e: any) => Boolean(e.infoHash)).length,
        externalPages: entries.filter((e: any) => Boolean(e.externalUrl)).length };
      diagnostics.push({ provider: provider.hostname,
        status: streams.length ? 'Candidate browser streams' : entries.length ? 'No browser-video URL candidates' : 'No streams returned',
        returned: entries.length, compatible: streams.length, ...kinds });
      return streams;
    } catch (error) {
      diagnostics.push({ provider: provider.hostname, status: error instanceof Error && error.name === 'AbortError' ? 'Timeout' : 'Connection or response error' });
      return [];
    } finally { clearTimeout(timeout); }
  }));
  const streams = results.flat().slice(0, 60);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ streams, configured: true, diagnostics });
});

// Online Stremio subtitles (including configured OpenSubtitles PRO), with a safe caption relay.
installSubtitleGateway(app, fetchFromTmdb);

async function startServer() {
  app.use(serveAppLanding);
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`FlixLeo server listening on 0.0.0.0:${PORT}`);
  });
  server.on('error', (error) => { console.error('FlixLeo listen failed:', error); process.exitCode = 1; });
}

startServer().catch((error) => { console.error('FlixLeo startup failed:', error); process.exitCode = 1; });