import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getLatestWindowsInstaller } from './windowsDownload';

/** Multi-application update/notice gateway backed by Supabase REST.
 * Run the SQL migration before use. GATEWAY_ADMIN_TOKEN and
 * SUPABASE_SERVICE_ROLE_KEY must only exist in server environment variables.
 */
const router = Router();
const allowedApps = new Set(['flixleo-android','flixleo-windows','sabdham-android','sri-tunnel-android']);
const idPattern = /^[a-z][a-z0-9-]{2,63}$/;
const storeUrl = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const storeKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminSecret = () => process.env.GATEWAY_ADMIN_TOKEN || '';
const baselineVersions: Record<string, number> = {
  'flixleo-android': 1, 'flixleo-windows': 1, 'sabdham-android': 17, 'sri-tunnel-android': 8
};
// Read-only, non-blocking fallback. Never invent a release or enforce an update when
// the database, migration or credentials are missing.
const safeDefaultPolicy = (appId: string, version: number) => ({
  appId, latestVersionCode: baselineVersions[appId] || 0, minVersionCode: 0,
  latestVersionName: '', updateAvailable: false, forceUpdate: false,
  updateUrl: null, notes: '', maintenance: false, maintenanceMessage: ''
});
function isAdmin(req: Request) {
  const expected = adminSecret();
  const provided = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (expected.length < 32 || !provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
async function supabase(path: string, init: RequestInit = {}) {
  if (!storeUrl() || !storeKey()) throw new Error('Gateway database is not configured');
  const result = await fetch(storeUrl() + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: storeKey(), Authorization: 'Bearer ' + storeKey(),
      'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(7000)
  });
  if (!result.ok) throw new Error('Gateway database request failed: ' + result.status);
  return result.status === 204 ? null : result.json();
}
function sanitizePolicy(row: any, clientVersion: number) {
  const latest = Number(row.latest_version_code) || 0;
  const minimum = Number(row.min_version_code) || 0;
  return {
    appId: row.app_id, latestVersionCode: latest, minVersionCode: minimum,
    latestVersionName: row.latest_version_name || '',
    updateAvailable: latest > clientVersion,
    forceUpdate: Boolean(row.force_update) && clientVersion < minimum,
    updateUrl: row.update_url || null, notes: row.release_notes || '',
    maintenance: Boolean(row.maintenance),
    maintenanceMessage: row.maintenance_message || ''
  };
}
// Public GitHub releases back the FlixLeo Windows update gate even when the
// Supabase admin policy has not yet been updated. No other app is affected.
function promoteWindowsRelease(policy: any, version: number,
  release: {url:string;version:string;versionCode:number} | null) {
  if (!release || release.versionCode < Number(policy.latestVersionCode || 0)) return policy;
  return {
    ...policy,
    latestVersionCode: release.versionCode,
    latestVersionName: release.version,
    updateUrl: release.url,
    updateAvailable: release.versionCode > version,
    notes: policy.notes || 'FlixLeo Windows installer update available.'
  };
}

type AndroidRelease = { url: string; version: string; versionCode: number };
let androidReleaseCache: { expires: number; release: AndroidRelease | null } | null = null;
async function getLatestPublicSignedAndroid(): Promise<AndroidRelease | null> {
  if (androidReleaseCache && Date.now() < androidReleaseCache.expires) return androidReleaseCache.release;
  let release: AndroidRelease | null = null;
  try {
    const response = await fetch('https://api.github.com/repos/PrasanthXo/FlixLeo/releases?per_page=30', {
      headers: { 'User-Agent': 'FlixLeo-Android-Update-Gateway', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const releases: any = await response.json();
      for (const item of Array.isArray(releases) ? releases : []) {
        if (item.draft || item.prerelease) continue;
        // Private signing workflow publishes 1.6.x with code 100000 + run.
        // Older signed 1.5.x builds use 1000 + run. Compare Android codes,
        // not GitHub publication order, so every installed version sees upgrades.
        const match = /^android-v1\.(5|6)\.(\d+)$/.exec(String(item.tag_name || ''));
        if (!match) continue;
        const releaseName = '1.' + match[1] + '.' + match[2];
        const asset = (Array.isArray(item.assets) ? item.assets : []).find((a: any) =>
          String(a.name || '') === 'FlixLeo-Android-v' + releaseName + '-signed.apk' &&
          Number(a.size) > 8_000_000 && a.state === 'uploaded' &&
          /^https:\/\/github\.com\/PrasanthXo\/FlixLeo\/releases\/download\//i.test(String(a.browser_download_url || '')));
        if (!asset) continue;
        const candidate = { url: String(asset.browser_download_url),
          version: releaseName, versionCode: (match[1] === '6' ? 100000 : 1000) + Number(match[2]) };
        if (!release || candidate.versionCode > release.versionCode) release = candidate;
      }
    }
  } catch { /* Retain non-forcing fallback when GitHub cannot be reached. */ }
  // Verified public signed release fallback. Older installed clients must still
  // discover a published update if GitHub's API times out or rate-limits Render.
  const verifiedFallback: AndroidRelease = {
    version: '1.5.14', versionCode: 1014,
    url: 'https://github.com/PrasanthXo/FlixLeo/releases/download/android-v1.5.14/FlixLeo-Android-v1.5.14-signed.apk'
  };
  if (!release || release.versionCode < verifiedFallback.versionCode) release = verifiedFallback;
  androidReleaseCache = { expires: Date.now() + 120000, release };
  return release;
}
function promoteAndroidRelease(policy: any, installedVersion: number, release: AndroidRelease | null) {
  if (!release || release.versionCode < Number(policy.latestVersionCode || 0)) return policy;
  return { ...policy, latestVersionCode: release.versionCode,
    latestVersionName: release.version, updateUrl: release.url,
    updateAvailable: release.versionCode > installedVersion,
    // Release discovery cannot mandate a forced update. Preserve any valid administrator policy.
    forceUpdate: Boolean(policy.forceUpdate) && installedVersion < Number(policy.minVersionCode || 0),
    notes: policy.notes || 'FlixLeo Android update available.' };
}

router.get('/api/gateway/v1/health', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, databaseConfigured: Boolean(storeUrl() && storeKey()),
    adminConfigured: adminSecret().length >= 32 });
});
router.get('/api/gateway/v1/check/:appId', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const appId = String(req.params.appId || '');
  const version = Number(req.query.versionCode);
  if (!allowedApps.has(appId) || !Number.isSafeInteger(version) || version < 0) {
    return res.status(400).json({ error: 'Invalid app or versionCode' });
  }
  const windowsRelease = appId === 'flixleo-windows' ? await getLatestWindowsInstaller() : null;
  const androidRelease = appId === 'flixleo-android' ? await getLatestPublicSignedAndroid() : null;
  const promote = (policy: any) => promoteAndroidRelease(promoteWindowsRelease(policy, version, windowsRelease), version, androidRelease);
  const publicReleaseReady = Boolean(windowsRelease || androidRelease);
  try {
    const data = await supabase('app_update_policies?app_id=eq.' + encodeURIComponent(appId) + '&select=*&limit=1');
    if (!Array.isArray(data) || !data.length) {
      return res.json({ policy: promote(safeDefaultPolicy(appId, version)),
        notices: [], ready: publicReleaseReady, reason: publicReleaseReady ? 'published_release' : 'policy_missing' });
    }
    const notices = await supabase('app_update_notices?app_id=eq.' + encodeURIComponent(appId) +
      '&active=eq.true&select=id,title,body,severity,created_at&order=created_at.desc&limit=10');
    return res.json({ policy: promote(sanitizePolicy(data[0], version)),
      notices: notices || [], ready: true });
  } catch {
    // A published Windows installer can still be offered as an optional update
    // if the admin database is down. Other apps retain the original safe fallback.
    return res.json({ policy: promote(safeDefaultPolicy(appId, version)),
      notices: [], ready: publicReleaseReady,
      reason: publicReleaseReady ? 'published_release' : 'gateway_unavailable' });
  }
});
router.get('/api/gateway/v1/admin/apps', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { return res.json({ apps: await supabase('app_update_policies?select=*&order=app_id.asc') }); }
  catch { return res.status(503).json({ error: 'Update service unavailable' }); }
});
router.put('/api/gateway/v1/admin/apps/:appId', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const appId = String(req.params.appId || '');
  if (!allowedApps.has(appId) || !idPattern.test(appId)) return res.status(400).json({ error: 'Unknown app' });
  const x = req.body || {};
  const min = x.minVersionCode, latest = x.latestVersionCode;
  if (!Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(latest) || latest < min ||
      typeof x.forceUpdate !== 'boolean' || typeof x.maintenance !== 'boolean' ||
      typeof x.latestVersionName !== 'string' || x.latestVersionName.length > 50 ||
      typeof x.releaseNotes !== 'string' || x.releaseNotes.length > 4000 ||
      typeof x.maintenanceMessage !== 'string' || x.maintenanceMessage.length > 500) {
    return res.status(400).json({ error: 'Invalid policy fields' });
  }
  if (typeof x.updateUrl !== 'string' || x.updateUrl.length > 2048) return res.status(400).json({ error: 'Invalid update URL' });
  try {
    const dest = new URL(x.updateUrl);
    if (dest.protocol !== 'https:' || dest.username || dest.password) throw new Error();
    // A required/optional upgrade must offer a real installer, not a homepage.
    const isBinary = appId === 'flixleo-windows' ? /\.exe$/i.test(dest.pathname)
      : /\.apk$/i.test(dest.pathname);
    const olderBaseline = baselineVersions[appId] || 0;
    if ((latest > olderBaseline || min > olderBaseline || x.forceUpdate) && !isBinary) {
      return res.status(400).json({ error: 'Updates require a direct HTTPS installer (.apk or .exe), not a homepage' });
    }
  } catch { return res.status(400).json({ error: 'Update URL must be HTTPS' }); }
  try {
    const data = await supabase('app_update_policies?on_conflict=app_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ app_id: appId, latest_version_code: latest, min_version_code: min,
        latest_version_name: x.latestVersionName, force_update: x.forceUpdate, maintenance: x.maintenance,
        update_url: x.updateUrl, release_notes: x.releaseNotes, maintenance_message: x.maintenanceMessage,
        updated_at: new Date().toISOString() })
    });
    return res.json({ app: data?.[0] });
  } catch { return res.status(503).json({ error: 'Unable to save policy' }); }
});
router.post('/api/gateway/v1/admin/notices', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { appId, title, body, severity } = req.body || {};
  if (!allowedApps.has(appId) || typeof title !== 'string' || !title.trim() || title.length > 120 ||
    typeof body !== 'string' || !body.trim() || body.length > 1000 ||
    !['info','warning','critical'].includes(severity)) return res.status(400).json({ error: 'Invalid notice' });
  try {
    const data = await supabase('app_update_notices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ app_id: appId, title, body, severity, active: true })
    });
    return res.status(201).json({ notice: data?.[0] });
  } catch { return res.status(503).json({ error: 'Unable to publish notice' }); }
});
router.delete('/api/gateway/v1/admin/notices/:id', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid notice' });
  try {
    await supabase('app_update_notices?id=eq.' + encodeURIComponent(req.params.id), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false })
    });
    return res.status(204).end();
  } catch { return res.status(503).json({ error: 'Unable to deactivate notice' }); }
});
export default router;
