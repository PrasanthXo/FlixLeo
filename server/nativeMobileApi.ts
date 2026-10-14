import { Router, type Request, type Response } from 'express';

/**
 * Narrow native-Android REST gateway for existing Supabase accounts.
 * Uses the public anon key server-side; NEVER the service-role/admin key.
 * Every private read/write is authorized with the user's own JWT under RLS.
 * The web application and its routes are untouched.
 */
const router = Router();
const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const ready = () => /^https:\/\/[^/]+/.test(base) && apiKey.length > 10;
const identity = async (bearer: string) => {
  const response = await remote('/auth/v1/user', { method: 'GET' }, bearer);
  if (!response.ok || !response.data?.id || !response.data.email_confirmed_at) return null;
  return response.data;
};
type UpstreamResponse = { ok: boolean; status: number; data: any };
async function remote(path: string, init: RequestInit = {}, token?: string): Promise<UpstreamResponse> {
  if (!ready()) return { ok: false, status: 503, data: { error: 'Cloud accounts are not configured.' } };
  try {
    const controller = AbortSignal.timeout(12000);
    const response = await fetch(base + path, {
      ...init,
      signal: controller,
      redirect: 'error',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 503, data: { error: 'Account service is temporarily unavailable.' } };
  }
}
function message(r: UpstreamResponse): string {
  const err = r.data || {};
  return String(err.msg || err.error_description || err.message || err.error || 'Account service unavailable').slice(0, 200);
}
function token(req: Request): string | null {
  const match = /^Bearer ([a-zA-Z0-9._-]{20,4096})$/.exec(req.headers.authorization || '');
  return match ? match[1] : null;
}
const hits = new Map<string, { count: number; expires: number }>();
function throttle(req: Request, res: Response, next: () => void) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  if (hits.size > 10000) for (const [k, v] of hits) if (v.expires <= now) hits.delete(k);
  const entry = hits.get(key);
  if (!entry || entry.expires < now) hits.set(key, { count: 1, expires: now + 60_000 });
  else if (++entry.count > 15) return void res.status(429).json({ error: 'Too many account attempts. Wait a minute.' });
  next();
}
router.use('/api/native', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.post('/api/native/auth/login', throttle, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!/^.+@.+\..+$/.test(email) || !password || email.length > 255 || password.length > 256) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }
  const session = await remote('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!session.ok) return res.status(session.status).json({ error: message(session) });
  const user = await identity(session.data.access_token);
  if (!user) return res.status(403).json({ error: 'Confirm your email address before signing in.' });
  return res.json({ session: { access_token: session.data.access_token, refresh_token: session.data.refresh_token, expires_in: session.data.expires_in }, user });
});
router.post('/api/native/auth/refresh', throttle, async (req, res) => {
  const refreshToken = String(req.body?.refresh_token || '');
  if (!/^[a-zA-Z0-9._-]{20,4096}$/.test(refreshToken)) return res.status(400).json({ error: 'Invalid refresh session.' });
  const session = await remote('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!session.ok) return res.status(401).json({ error: 'Session expired; sign in again.' });
  const user = await identity(session.data.access_token);
  if (!user) return res.status(403).json({ error: 'Email verification required.' });
  return res.json({ session: { access_token: session.data.access_token, refresh_token: session.data.refresh_token, expires_in: session.data.expires_in }, user });
});
router.post('/api/native/auth/signup', throttle, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!/^.+@.+\..+$/.test(email) || email.length > 255 || password.length < 8 || password.length > 256) return res.status(400).json({ error: 'Use a valid email and password of at least 8 characters.' });
  const result = await remote('/auth/v1/signup?redirect_to=' + encodeURIComponent('https://flixleo.cyou/'), { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!result.ok) return res.status(result.status).json({ error: message(result) });
  return res.json({ success: true, message: 'Check your email to verify the account before signing in.' });
});
router.post('/api/native/auth/resend', throttle, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^.+@.+\..+$/.test(email)) return res.status(400).json({ error: 'Enter your email address.' });
  await remote('/auth/v1/resend?redirect_to=' + encodeURIComponent('https://flixleo.cyou/'), { method: 'POST', body: JSON.stringify({ type: 'signup', email }) });
  return res.json({ success: true, message: 'If eligible, a verification email has been sent.' });
});
router.post('/api/native/auth/recover', throttle, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^.+@.+\..+$/.test(email)) return res.status(400).json({ error: 'Enter your email address.' });
  await remote('/auth/v1/recover?redirect_to=' + encodeURIComponent('https://flixleo.cyou/'), { method: 'POST', body: JSON.stringify({ email }) });
  return res.json({ success: true, message: 'If registered, a password-reset email has been sent.' });
});
router.post('/api/native/auth/logout', async (req, res) => {
  const jwt = token(req);
  if (jwt) await remote('/auth/v1/logout', { method: 'POST' }, jwt);
  return res.json({ success: true });
});
async function verified(req: Request, res: Response): Promise<{ token: string; user: any } | null> {
  const jwt = token(req);
  if (!jwt) { res.status(401).json({ error: 'Sign in first.' }); return null; }
  const user = await identity(jwt);
  if (!user) { res.status(401).json({ error: 'Your session has expired.' }); return null; }
  return { token: jwt, user };
}
router.get('/api/native/account', async (req, res) => {
  const auth = await verified(req, res);
  if (auth) return res.json({ user: auth.user });
});
router.put('/api/native/account', async (req, res) => {
  const auth = await verified(req, res);
  if (!auth) return;
  const raw = req.body || {};
  const data: Record<string, any> = {};
  for (const key of ['display_name','preferred_language']) {
    if (typeof raw[key] === 'string') data[key] = raw[key].slice(0, 100);
  }
  for (const key of ['favorite_languages','favorite_genres','favorite_artists']) {
    if (Array.isArray(raw[key])) data[key] = raw[key].filter((v: unknown) => typeof v === 'string').slice(0, 20).map((v: string) => v.slice(0, 80));
  }
  const updated = await remote('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ data }) }, auth.token);
  return res.status(updated.status).json(updated.ok ? { user: updated.data } : { error: message(updated) });
});
router.get('/api/native/data', async (req, res) => {
  const auth = await verified(req, res);
  if (!auth) return;
  const row = await remote('/rest/v1/flixleo_user_data?select=payload&user_id=eq.' + encodeURIComponent(auth.user.id) + '&limit=1', {}, auth.token);
  if (!row.ok) return res.status(row.status).json({ error: message(row) });
  return res.json({ payload: Array.isArray(row.data) ? (row.data[0]?.payload ?? null) : null });
});
router.put('/api/native/data', async (req, res) => {
  const auth = await verified(req, res);
  if (!auth) return;
  const body = req.body || {};
  if (!Array.isArray(body.watchlist) || !Array.isArray(body.history) ||
      body.watchlist.length > 500 || body.history.length > 50) return res.status(400).json({ error: 'Invalid user-data payload.' });
  const watchlist = body.watchlist.filter((v: unknown) => typeof v === 'string' && v.length <= 100).slice(0, 500);
  const history = body.history.filter((v: any) => v && typeof v === 'object' && typeof v.media?.id === 'string').slice(0, 20);
  const row = await remote('/rest/v1/flixleo_user_data?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: auth.user.id, payload: { watchlist, history, updatedAt: Date.now() }, updated_at: new Date().toISOString() })
  }, auth.token);
  return res.status(row.ok ? 200 : row.status).json(row.ok ? { success: true } : { error: message(row) });
});
export default router;
