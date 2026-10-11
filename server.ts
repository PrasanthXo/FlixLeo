import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
    const details = await fetchFromTmdb(`/tv/${cleanId}`);
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
// Avoid repeatedly hitting providers that temporarily refuse Render requests.
// This cache is server-local and automatically expires.
const stremioProviderCooldown = new Map<string, number>();
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
  const configured = (process.env.STREMIO_ADDON_URLS || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 5);
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
    const providerTimeoutMs = provider.hostname.includes('webstreamr') || provider.hostname.includes('baby-beamup.club') ? 18000 : 7500;
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
        const quality = /2160p|4k/i.test(label) ? '4K' : /1080p/i.test(label) ? '1080p' : /720p/i.test(label) ? '720p' : /480p/i.test(label) ? '480p' : 'Auto';
        return [{ provider: provider.hostname, name: String(stream.name || 'Add-on stream').slice(0, 80),
          title: label, url: url.toString(), quality, streamType: hls ? 'hls' : 'direct-video' }];
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

async function startServer() {
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