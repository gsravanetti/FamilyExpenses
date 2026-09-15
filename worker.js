const SESSION_COOKIE = 'personal_os_session';
const OAUTH_COOKIE = 'personal_os_oauth';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/api/auth/login' && request.method === 'GET') {
        return startLogin(request, env);
      }
      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        return finishLogin(request, env);
      }
      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        return sessionStatus(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        requireSameOrigin(request);
        return logout(request, env);
      }
      if (url.pathname === '/api/google') {
        return proxyGoogle(request, env);
      }
      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'Endpoint non trovato.' }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : 'Errore interno.' }, 500);
    }
  }
};

async function startLogin(request, env) {
  requireConfig(env);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get('returnTo'));
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const oauthPayload = await encryptJson({ state, verifier, returnTo, createdAt: Date.now() }, env.SESSION_SECRET);
  const redirectUri = `${requestUrl.origin}/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': cookie(OAUTH_COOKIE, oauthPayload, 600)
    }
  });
}

async function finishLogin(request, env) {
  requireConfig(env);
  const url = new URL(request.url);
  const oauthValue = readCookie(request, OAUTH_COOKIE);
  const oauth = oauthValue ? await decryptJson(oauthValue, env.SESSION_SECRET) : null;
  if (!oauth || !url.searchParams.get('state') || url.searchParams.get('state') !== oauth.state) {
    return htmlError('Sessione di accesso non valida. Torna alla home e riprova.', 400);
  }
  if (Date.now() - oauth.createdAt > 10 * 60 * 1000) {
    return htmlError('La richiesta di accesso è scaduta. Torna alla home e riprova.', 400);
  }
  const googleError = url.searchParams.get('error');
  if (googleError) return htmlError(`Google ha interrotto l'accesso: ${escapeHtml(googleError)}`, 400);
  const code = url.searchParams.get('code');
  if (!code) return htmlError('Google non ha restituito il codice di accesso.', 400);

  const redirectUri = `${url.origin}/api/auth/callback`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: oauth.verifier
    })
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) return htmlError(`Google OAuth: ${escapeHtml(tokens.error_description || tokens.error || 'scambio token non riuscito')}`, 400);

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await profileResponse.json();
  const email = String(profile.email || '').trim().toLowerCase();
  if (!profileResponse.ok || !email || !profile.email_verified) return htmlError('Non è stato possibile verificare l’account Google.', 403);
  if (!allowedEmails(env).has(email)) return htmlError('Questo account Google non è autorizzato.', 403);
  if (!tokens.refresh_token) return htmlError('Google non ha fornito il permesso permanente. Revoca l’accesso precedente all’app e riprova.', 400);

  const sessionValue = await encryptJson({
    email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessExpiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    createdAt: Date.now()
  }, env.SESSION_SECRET);

  const headers = new Headers({ Location: safeReturnTo(oauth.returnTo) });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, sessionValue, SESSION_MAX_AGE));
  headers.append('Set-Cookie', clearCookie(OAUTH_COOKIE));
  return new Response(null, { status: 302, headers });
}

async function sessionStatus(request, env) {
  const session = await getSession(request, env);
  if (!session || !allowedEmails(env).has(session.email)) return json({ authenticated: false });
  return json({ authenticated: true, email: session.email });
}

async function logout(request, env) {
  const session = await getSession(request, env);
  if (session?.refreshToken) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: session.refreshToken })
    }).catch(() => {});
  }
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE) } });
}

async function proxyGoogle(request, env) {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return json({ error: 'Metodo non consentito.' }, 405);
  if (request.method !== 'GET') requireSameOrigin(request);
  const session = await getSession(request, env);
  if (!session || !allowedEmails(env).has(session.email)) return json({ error: 'Sessione non valida.' }, 401);

  const targetText = new URL(request.url).searchParams.get('url');
  let target;
  try { target = new URL(targetText); } catch { return json({ error: 'URL Google non valido.' }, 400); }
  const calendarAllowed = target.protocol === 'https:' && target.hostname === 'www.googleapis.com' && target.pathname.startsWith('/calendar/v3/');
  const sheetsAllowed = target.protocol === 'https:' && target.hostname === 'sheets.googleapis.com' && target.pathname.startsWith('/v4/spreadsheets/');
  if (!calendarAllowed && !sheetsAllowed) return json({ error: 'API Google non consentita.' }, 403);

  const tokenResult = await validAccessToken(session, env);
  if (!tokenResult) return json({ error: 'Sessione Google scaduta.' }, 401, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${tokenResult.session.accessToken}`);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  const init = { method: request.method, headers };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();

  const googleResponse = await fetch(target.toString(), init);
  const responseHeaders = new Headers();
  const responseType = googleResponse.headers.get('Content-Type');
  if (responseType) responseHeaders.set('Content-Type', responseType);
  responseHeaders.set('Cache-Control', 'no-store');
  if (tokenResult.refreshed) {
    const updated = await encryptJson(tokenResult.session, env.SESSION_SECRET);
    responseHeaders.append('Set-Cookie', cookie(SESSION_COOKIE, updated, SESSION_MAX_AGE));
  }
  return new Response(googleResponse.body, { status: googleResponse.status, headers: responseHeaders });
}

async function validAccessToken(session, env) {
  if (session.accessToken && Number(session.accessExpiresAt) > Date.now() + 60_000) return { session, refreshed: false };
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) return null;
  session.accessToken = tokens.access_token;
  session.accessExpiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return { session, refreshed: true };
}

async function getSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;
  try { return await decryptJson(value, env.SESSION_SECRET); } catch { return null; }
}

function requireConfig(env) {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'ALLOWED_EMAILS'].filter(key => !env[key]);
  if (missing.length) throw new Error(`Configurazione Cloudflare incompleta: ${missing.join(', ')}`);
}

function allowedEmails(env) {
  return new Set(String(env.ALLOWED_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const expected = new URL(request.url).origin;
  if (origin && origin !== expected) throw new Error('Origine della richiesta non valida.');
}

function safeReturnTo(value) {
  const path = String(value || '/');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function encryptionKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptJson(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), data);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return base64url(combined);
}

async function decryptJson(value, secret) {
  const combined = fromBase64url(value);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function randomToken(bytes) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

function htmlError(message, status) {
  return new Response(`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Accesso non riuscito</title><body style="font-family:system-ui;padding:32px;max-width:650px;margin:auto"><h1>Accesso non riuscito</h1><p>${message}</p><p><a href="/">Torna alla dashboard</a></p></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
