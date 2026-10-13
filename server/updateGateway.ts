import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

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
  try {
    const data = await supabase('app_update_policies?app_id=eq.' + encodeURIComponent(appId) + '&select=*&limit=1');
    if (!Array.isArray(data) || !data.length) return res.json({ policy: safeDefaultPolicy(appId, version), notices: [], ready: false, reason: 'policy_missing' });
    const notices = await supabase('app_update_notices?app_id=eq.' + encodeURIComponent(appId) +
      '&active=eq.true&select=id,title,body,severity,created_at&order=created_at.desc&limit=10');
    return res.json({ policy: sanitizePolicy(data[0], version), notices: notices || [], ready: true });
  } catch {
    // Installed clients must continue to work if Supabase is temporarily offline.
    return res.json({ policy: safeDefaultPolicy(appId, version), notices: [], ready: false, reason: 'gateway_unavailable' });
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
    const isBinary = appId === 'flixleo-windows' ? /\\.exe$/i.test(dest.pathname)
      : /\\.apk$/i.test(dest.pathname);
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
