import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type TmdbLookup = (path: string, params?: Record<string, string>) => Promise<any>;
type SubtitleFile = { url: string; expires: number };
const subtitleFiles = new Map<string, SubtitleFile>();

// OpenSubtitles PRO requires a language configuration in its manifest URL.
// Operators can override this preset with their own configured URL on Render.
const proSettings = {
  langs: ['english', 'tamil', 'sinhala', 'hindi', 'telugu', 'malayalam', 'kannada'],
  source: 'all',
  aiTranslated: true,
  autoAdjustment: false
};
const proBase = 'https://opensubtitlesv3-pro.dexter21767.com';
const proManifest = proBase + '/' + Buffer.from(JSON.stringify(proSettings)).toString('base64') + '/manifest.json';

function addonBase(value: string): string | null {
  try {
    const url = new URL(value.trim().replace(/\/manifest\.json(?:\?.*)?$/i, '').replace(/\/$/, ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      isIP(url.hostname) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

function validCaptionUrl(raw: string): URL | null {
  if (raw.length > 3000) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      isIP(url.hostname) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

// Fail closed for private and reserved IPs before downloading any addon-provided URL.
function publicIp(address: string): boolean {
  if (address.includes(':')) {
    const ip = address.toLowerCase();
    return /^[23][0-9a-f]/.test(ip) && !ip.startsWith('2001:db8:');
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = octets;
  return a > 0 && a < 224 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 198 && (b === 18 || b === 19)) &&
    !(a === 203 && b === 0 && c === 113) && !(a === 192 && b === 0 && c === 2) &&
    !(a === 198 && b === 51 && c === 100);
}

function subtitleTicket(url: string): string {
  const now = Date.now();
  for (const [key, record] of subtitleFiles) if (record.expires < now) subtitleFiles.delete(key);
  if (subtitleFiles.size >= 700) subtitleFiles.delete(subtitleFiles.keys().next().value!);
  const ticket = randomUUID();
  subtitleFiles.set(ticket, { url, expires: now + 30 * 60_000 });
  return '/api/stremio/subtitle-file/' + ticket;
}

export function installSubtitleGateway(app: Express, fetchFromTmdb: TmdbLookup) {
  // Ticket is issued only for a caption URL returned by a server-configured addon.
  // This prevents the caption relay from becoming a public arbitrary-URL proxy.
  app.get('/api/stremio/subtitle-file/:ticket', async (req: Request, res: Response) => {
    const record = subtitleFiles.get(String(req.params.ticket || ''));
    if (!record || record.expires < Date.now()) return res.status(404).send('Subtitle expired; search again.');
    const url = validCaptionUrl(record.url);
    if (!url) return res.status(400).send('Invalid subtitle source.');
    try {
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(item => !publicIp(item.address))) {
        return res.status(403).send('Subtitle host is not permitted.');
      }
      const response = await fetch(url.href, {
        redirect: 'error',
        signal: AbortSignal.timeout(7500),
        headers: { Accept: 'text/vtt,text/plain,application/x-subrip,*/*' }
      });
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 2_000_000 || !response.body) {
        return res.status(502).send('Subtitle source unavailable.');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); return res.status(413).send('Subtitle too large.'); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return res.status(415).send('Zipped subtitles are unsupported.');
      const charset = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
      const body = new TextDecoder(charset).decode(bytes).replace(/^\uFEFF/, '');
      if (!body.trimStart().startsWith('WEBVTT') &&
          !/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(body)) {
        return res.status(415).send('Unsupported subtitle format.');
      }
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.type('text/plain; charset=utf-8').send(body);
    } catch { return res.status(502).send('Subtitle download failed.'); }
  });

  app.get('/api/stremio/subtitles', async (req: Request, res: Response) => {
    const type = String(req.query.type || '');
    const tmdb = String(req.query.tmdb || '');
    const season = Number(req.query.season);
    const episode = Number(req.query.episode);
    if (!['movie', 'series'].includes(type) || !/^\d{1,12}$/.test(tmdb) ||
        (type === 'series' && (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1))) {
      return res.status(400).json({ subtitles: [], error: 'Invalid title or episode.' });
    }
    try {
      const external = await fetchFromTmdb('/' + (type === 'series' ? 'tv' : 'movie') + '/' + tmdb + '/external_ids');
      const imdb = String(external?.imdb_id || '');
      if (!/^tt\d{5,12}$/.test(imdb)) return res.json({ subtitles: [] });
      const sources = [
        process.env.STREMIO_SUBTITLE_ADDON_URL || proManifest,
        ...(process.env.STREMIO_ADDON_URLS || '').split(',')
      ].map(value => addonBase(value)).filter((value): value is string => Boolean(value)).filter((value, i, values) => values.indexOf(value) === i).slice(0, 7);
      const videoId = imdb + (type === 'series' ? ':' + season + ':' + episode : '');
      const settled = await Promise.allSettled(sources.map(async base => {
        const response = await fetch(base + '/subtitles/' + type + '/' + videoId + '.json', {
          redirect: 'error', signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' }
        });
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 1_000_000) return [];
        const data = JSON.parse((await response.text()).slice(0, 1_000_001));
        const provider = base.startsWith(proBase) ? 'OpenSubtitles PRO' : 'Stremio subtitles';
        return (Array.isArray(data.subtitles) ? data.subtitles : []).slice(0, 40).flatMap((track: any) => {
          if (typeof track.url !== 'string' || !validCaptionUrl(track.url)) return [];
          const language = String(track.lang || track.language || 'und').slice(0, 20);
          const label = String(track.name || track.id || language).replace(/[\r\n<>]/g, '').slice(0, 75);
          return [{ url: track.url, label: provider + ' · ' + label, language }];
        });
      }));
      const tracks = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const unique = [...new Map(tracks.map(track => [track.url, track])).values()].slice(0, 60);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ subtitles: unique.map(track => ({
        label: track.label, language: track.language, url: subtitleTicket(track.url)
      })) });
    } catch { return res.json({ subtitles: [] }); }
  });
}
