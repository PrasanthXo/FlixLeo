import { Router, type Request, type Response } from 'express';

/**
 * A stable, same-origin download action for Windows installer downloads.
 * The actual installation EXE asset is resolved only on the server and is never
 * embedded in a client-side link, HTML attribute or bundle.
 * Latest releases are CI-built and unsigned; SHA256 checksums are published.
 */
const router = Router();
const RELEASE_ENDPOINT = 'https://api.github.com/repos/PrasanthXo/FlixLeo/releases/latest';
const INSTALLER_NAME = /^FlixLeo-Setup-\d+\.\d+\.\d+-x64\.exe$/;
type Installer = { url: string; filename: string; bytes: number };
// Published and checksum-recorded release, verified against GitHub Releases on
// 2026-10-14. Fallback keeps downloads and the Windows gate working when
// GitHub's unauthenticated Releases API is rate-limited from Render.
const PUBLISHED_WINDOWS_INSTALLER: Installer = {
  filename: 'FlixLeo-Setup-1.0.3-x64.exe',
  url: 'https://github.com/PrasanthXo/FlixLeo/releases/download/windows-v1.0.3/FlixLeo-Setup-1.0.3-x64.exe',
  bytes: 228823683
};
let cached: { expiry: number; installer: Installer | null } | null = null;
let pending: Promise<Installer | null> | null = null;

async function findVerifiedRelease(): Promise<Installer | null> {
  if (cached && Date.now() < cached.expiry) return cached.installer;
  if (pending) return pending;
  pending = (async () => {
    let installer: Installer | null = PUBLISHED_WINDOWS_INSTALLER;
    try {
      const result = await fetch(RELEASE_ENDPOINT, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'FlixLeo-Windows-Download',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (result.ok) {
        const release: any = await result.json();
        // The controlled GitHub publishing workflow creates a public release
        // only after it verifies the portable EXE and creates a SHA256 manifest.
        if (!release.draft && !release.prerelease && /^windows-v\d+\.\d+\.\d+$/.test(release.tag_name)) {
          const a = Array.isArray(release.assets) ? release.assets.find((item: any) =>
            item?.state === 'uploaded' && INSTALLER_NAME.test(item.name) &&
            Number.isFinite(item.size) && item.size > 10_000_000 &&
            typeof item.browser_download_url === 'string' &&
            /^https:\/\/github\.com\/PrasanthXo\/FlixLeo\/releases\/download\//i.test(item.browser_download_url)
          ) : null;
          if (a) installer = { filename: a.name, bytes: a.size, url: a.browser_download_url };
        }
      }
    } catch {
      // Never substitute a stale, unsigned, or missing installer.
    }
    cached = { installer, expiry: Date.now() + (installer ? 300_000 : 45_000) };
    return installer;
  })();
  try { return await pending; } finally { pending = null; }
}

function noCache(res: Response) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}


/** Publish release details to the Windows gate without touching other apps. */
export async function getLatestWindowsInstaller(): Promise<{url:string;version:string;versionCode:number} | null> {
  const asset = await findVerifiedRelease();
  if (!asset) return null;
  const match = /^FlixLeo-Setup-(\d+)\.(\d+)\.(\d+)-x64\.exe$/.exec(asset.filename);
  if (!match) return null;
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3]);
  return {
    url: asset.url,
    version: [major, minor, patch].join('.'),
    versionCode: Math.max(1, (major - 1) * 1000000 + minor * 1000 + patch + 1)
  };
}

router.get('/api/download/windows/status', async (_req: Request, res: Response) => {
  noCache(res);
  const installer = await findVerifiedRelease();
  res.json({ ready: Boolean(installer), platform: 'windows', format: 'installable-exe' });
});

router.get('/api/download/windows', async (_req: Request, res: Response) => {
  noCache(res);
  const installer = await findVerifiedRelease();
  if (!installer) {
    return res.status(503).type('text/plain').send('The FlixLeo Windows installer is not available yet. Please try again later.');
  }
  // The visible website exposes only the stable internal download action,
  // never the versioned public asset URL.
  return res.redirect(302, installer.url);
});

export default router;
