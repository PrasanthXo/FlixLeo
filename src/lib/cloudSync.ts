export type CloudUser = { id: string; email?: string; email_confirmed_at?: string | null; user_metadata?: { display_name?: string; preferred_language?: string; favorite_languages?: string[]; favorite_genres?: string[]; favorite_artists?: string[] } };
type Session = { access_token: string; refresh_token: string; expires_at: number; user: CloudUser };
const KEY = 'flixleo_cloud_session';
export const cloudConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const apikey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
// Explicit production redirect prevents Supabase falling back to localhost:3000.
const authRedirect = 'https://flixleo.cyou/';
const redirectQuery = '?redirect_to=' + encodeURIComponent(authRedirect);
let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
if (session && !session.user?.email_confirmed_at) { session = null; try { localStorage.removeItem(KEY); } catch {} }
const persist = (value: Session | null) => {
  session = value;
  try { value ? localStorage.setItem(KEY, JSON.stringify(value)) : localStorage.removeItem(KEY); } catch { /* ignore */ }
};
async function request(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...init,
    headers: { apikey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...init.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || body.error_description || body.message || 'Cloud request failed');
  return body;
}
export function currentCloudUser() { return cloudConfigured ? (session?.user || null) : null; }
async function accessToken() {
  if (!session) throw new Error('Sign in to sync your data.');
  if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
  const data = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const verifiedUser = await request('/auth/v1/user', {}, data.access_token);
  if (!verifiedUser.email_confirmed_at) { persist(null); throw new Error('Confirm your email address before signing in. Check your inbox or resend verification.'); }
  persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: verifiedUser, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  return data.access_token;
}
export async function cloudSignIn(email: string, password: string) {
  if (!cloudConfigured) throw new Error('Supabase is not configured yet.');
  const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  const verifiedUser = await request('/auth/v1/user', {}, data.access_token);
  if (!verifiedUser.email_confirmed_at) { persist(null); throw new Error('Email not verified. Confirm your email before signing in, or select Resend verification email.'); }
  persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: verifiedUser, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  return verifiedUser as CloudUser;
}
export async function cloudSignInTv(hash: string) {
  const data = await request('/auth/v1/verify', { method: 'POST', body: JSON.stringify({ token_hash: hash, type: 'magiclink' }) });
  const user = await request('/auth/v1/user', {}, data.access_token);
  if (!user.email_confirmed_at) throw new Error('Confirm your email first.');
  persist({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now()/1000) + data.expires_in, user });
  return user as CloudUser;
}
export async function cloudApproveTvPair(id: string) {
  const token = await accessToken();
  const response = await fetch('/api/tv/pair/' + encodeURIComponent(id) + '/approve', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error((await response.json()).error || 'Pairing failed');
}

export async function cloudSignUp(email: string, password: string) {
  if (!cloudConfigured) throw new Error('Supabase is not configured yet.');
  const data = await request('/auth/v1/signup' + redirectQuery, { method: 'POST', body: JSON.stringify({ email, password }) });
  // Do not create a logged-in session until the email is verified.
  if (data.access_token && data.user?.email_confirmed_at) {
    persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
    return true;
  }
  persist(null);
  return false;
}
export async function cloudResendVerification(email: string) {
  if (!cloudConfigured) throw new Error('Supabase is not configured yet.');
  if (!email.trim()) throw new Error('Enter your email address first.');
  await request('/auth/v1/resend' + redirectQuery, {
    method: 'POST',
    body: JSON.stringify({ type: 'signup', email: email.trim() })
  });
}
export async function cloudUpdateProfile(details: { display_name?: string; preferred_language?: string; favorite_languages?: string[]; favorite_genres?: string[]; favorite_artists?: string[] }) {
  const token = await accessToken();
  const result = await request('/auth/v1/user', {
    method: 'PUT', body: JSON.stringify({ data: details })
  }, token);
  if (session) persist({ ...session, user: result });
  return result as CloudUser;
}
export async function cloudChangePassword(password: string) {
  if (password.length < 8) throw new Error('Use at least 8 characters.');
  const token = await accessToken();
  await request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) }, token);
}
export async function cloudResetPassword(email: string) {
  if (!email.trim()) throw new Error('Enter your email address first.');
  await request('/auth/v1/recover' + redirectQuery, { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
}
// Handle Supabase recovery links without storing the temporary recovery session.
export async function cloudRecoveryTokenFromUrl(): Promise<string | null> {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const access = hash.get('access_token');
  if (hash.get('type') === 'recovery' && access) {
    const user = await request('/auth/v1/user', {}, access);
    if (!user?.id) throw new Error('Recovery link is invalid or expired.');
    window.history.replaceState({}, '', window.location.pathname);
    return access;
  }
  const tokenHash = query.get('token_hash');
  if (tokenHash && query.get('type') === 'recovery') {
    const data = await request('/auth/v1/verify', {
      method: 'POST', body: JSON.stringify({ token_hash: tokenHash, type: 'recovery' })
    });
    if (!data.access_token) throw new Error('Recovery link has expired.');
    window.history.replaceState({}, '', window.location.pathname);
    return data.access_token;
  }
  return null;
}
export async function cloudCompleteRecovery(token: string, password: string) {
  if (!token) throw new Error('Request a new password reset link.');
  if (password.length < 8) throw new Error('Use at least 8 characters.');
  await request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) }, token);
  await request('/auth/v1/logout', { method: 'POST' }, token).catch(() => {});
}

export async function cloudSignOut() {
  const token = await accessToken().catch(() => '');
  if (token) await request('/auth/v1/logout', { method: 'POST' }, token).catch(() => {});
  persist(null);
}
export type CloudRecord = { watchlist: string[]; history: { media: any; progress: number; duration: number; updatedAt: number }[]; updatedAt: number };
export async function cloudRead(): Promise<CloudRecord | null> {
  const token = await accessToken();
  const rows = await request('/rest/v1/flixleo_user_data?select=payload&limit=1', {}, token);
  return Array.isArray(rows) && rows[0]?.payload ? rows[0].payload : null;
}
export async function cloudWrite(payload: CloudRecord) {
  const token = await accessToken();
  await request('/rest/v1/flixleo_user_data?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: session!.user.id, payload, updated_at: new Date().toISOString() })
  }, token);
}
export function mergeCloudData(local: CloudRecord, remote: CloudRecord | null): CloudRecord {
  const demoIds = new Set(['stream-overdrive-4k', 'stream-rajputana-warrior']);
  const watchlist = Array.from(new Set([...(remote?.watchlist || []), ...local.watchlist].filter(id => typeof id === 'string' && !demoIds.has(id))));
  const history = [...(remote?.history || []), ...local.history]
    .filter(entry => entry?.media?.id && Number.isFinite(entry.progress))
    .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const ids = new Set<string>();
  return { watchlist, history: history.filter(entry => {
    if (ids.has(entry.media.id)) return false;
    ids.add(entry.media.id);
    return true;
  }).slice(0, 20), updatedAt: Date.now() };
}
