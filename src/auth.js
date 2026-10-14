// Accounts via Supabase Auth, using its REST API directly (no library: MV3 forbids remote
// code and this keeps the extension dependency-free).
//
// Session = { access_token, refresh_token, expires_at (s), user: { id, email, user_metadata } }
// stored in chrome.storage.local under 'session'. All extension pages and the service
// worker read it from there; chrome.storage.onChanged keeps them in sync.
//
// Google sign-in uses chrome.identity.launchWebAuthFlow with Supabase's OAuth endpoint and
// the redirect https://<extension-id>.chromiumapp.org/ (add it in Supabase → Auth → URL
// configuration → Redirect URLs). Run it from the service worker (message AUTH_GOOGLE) so it
// survives the popup closing when the Google window opens.

import { CONFIG, DEV_MODE } from './config.js';

const base = () => `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

function friendly(message, status) {
  const m = String(message || '');
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first — check your inbox for the link.';
  if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/password should be at least|weak/i.test(m)) return 'Choose a stronger password (at least 8 characters).';
  if (/rate limit|too many/i.test(m) || status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Can’t reach the server. Check your internet connection.';
  return m || 'Something went wrong. Please try again.';
}

async function call(path, { method = 'POST', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(friendly(err.message));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(data.msg || data.error_description || data.message || data.error, res.status));
  return data;
}

function toSession(data) {
  if (!data?.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: data.user ? { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata || {} } : null,
  };
}

async function save(session) {
  if (session) await chrome.storage.local.set({ session });
  else await chrome.storage.local.remove(['session', 'entitlement']);
  return session;
}

// ---- Public API ----------------------------------------------------------------

export async function getSession({ refresh = true } = {}) {
  if (DEV_MODE) return { dev: true, user: { id: 'dev', email: 'developer (no backend configured)' } };
  const { session } = await chrome.storage.local.get('session');
  if (!session) return null;
  if (refresh && session.expires_at - 60 < Date.now() / 1000) {
    try {
      return await save(toSession(await call('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })));
    } catch {
      await save(null);
      return null;
    }
  }
  return session;
}

export async function accessToken() {
  const s = await getSession();
  return s?.access_token || null;
}

export async function signUpWithEmail(email, password, name = '') {
  const data = await call('/signup', { body: { email, password, data: name ? { full_name: name } : {} } });
  const session = toSession(data);
  if (session) { await save(session); return { session }; }
  return { needsConfirmation: true }; // email confirmation is on in Supabase
}

export async function signInWithEmail(email, password) {
  return save(toSession(await call('/token?grant_type=password', { body: { email, password } })));
}

export async function sendPasswordReset(email) {
  await call('/recover', { body: { email } });
}

/** Google OAuth (run in the service worker). */
export async function signInWithGoogle() {
  const redirect = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const url = `${base()}/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&prompt=select_account`;
  let result;
  try {
    result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err) {
    throw new Error(/did not approve|cancel|closed/i.test(err.message) ? 'Google sign-in was cancelled.' : friendly(err.message));
  }
  const hash = new URLSearchParams(new URL(result).hash.slice(1));
  const query = new URL(result).searchParams;
  const error = hash.get('error_description') || query.get('error_description');
  if (error) throw new Error(friendly(error));
  const access = hash.get('access_token');
  if (!access) throw new Error('Google sign-in didn’t complete. Please try again.');
  const user = await call('/user', { method: 'GET', token: access });
  return save({
    access_token: access,
    refresh_token: hash.get('refresh_token'),
    expires_at: Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600),
    user: { id: user.id, email: user.email, user_metadata: user.user_metadata || {} },
  });
}

export async function signOut() {
  const s = await getSession({ refresh: false });
  if (s?.access_token && !s.dev) await call('/logout', { token: s.access_token }).catch(() => {});
  await save(null);
}

/** Authenticated call to PostgREST or an Edge Function. */
export async function api(path, { method = 'POST', body } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Please sign in.');
  const res = await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((err) => { throw new Error(friendly(err.message)); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}
