export type CloudUser = { id: string; email?: string; user_metadata?: { display_name?: string; preferred_language?: string } };
type Session = { access_token: string; refresh_token: string; expires_at: number; user: CloudUser };
const KEY = 'flixleo_cloud_session';
export const cloudConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const apikey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
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
  persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user || session.user, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  return data.access_token;
}
export async function cloudSignIn(email: string, password: string) {
  if (!cloudConfigured) throw new Error('Supabase is not configured yet.');
  const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  return data.user as CloudUser;
}
export async function cloudSignUp(email: string, password: string) {
  if (!cloudConfigured) throw new Error('Supabase is not configured yet.');
  const data = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (data.access_token) {
    persist({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  }
  return Boolean(data.access_token);
}
export async function cloudUpdateProfile(details: { display_name?: string; preferred_language?: string }) {
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
  await request('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
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
  const watchlist = Array.from(new Set([...(remote?.watchlist || []), ...local.watchlist]));
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
