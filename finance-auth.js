const SESSION_COOKIE = 'personal_os_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;
const FINANCE_SPREADSHEET_ID = '1kJn6t--UjFmxZ9q_Y8m8MNjjccmGkqhLiEOPsed4yhY';

export async function handleFinanceProxy(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Metodo non consentito.' }, 405, { Allow: 'GET' });
  }

  const session = await getSession(request, env);
  if (!session || !allowedEmails(env).has(session.email)) {
    return json({ error: 'Sessione non valida.' }, 401);
  }

  const targetText = new URL(request.url).searchParams.get('url');
  let target;
  try {
    target = new URL(targetText);
  } catch {
    return json({ error: 'URL Google non valido.' }, 400);
  }

  if (!isAllowedFinanceTarget(target, request.method)) {
    return json({ error: 'API Finance non consentita.' }, 403);
  }

  const tokenResult = await validAccessToken(session, env);
  if (!tokenResult) {
    return json({ error: 'Sessione Google scaduta.' }, 401, {
      'Set-Cookie': clearCookie(SESSION_COOKIE)
    });
  }

  const googleResponse = await fetch(target.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenResult.session.accessToken}` }
  });

  const headers = new Headers();
  const contentType = googleResponse.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'private, no-store');

  if (tokenResult.refreshed) {
    const updated = await encryptJson(tokenResult.session, env.SESSION_SECRET);
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, updated, SESSION_MAX_AGE));
  }

  return new Response(googleResponse.body, {
    status: googleResponse.status,
    headers
  });
}

export function isAllowedFinanceTarget(target, method) {
  if (method !== 'GET') return false;
  if (target.origin !== 'https://sheets.googleapis.com') return false;
  if (target.username || target.password || target.port) return false;

  let pathname;
  try {
    pathname = decodeURIComponent(target.pathname);
  } catch {
    return false;
  }

  const base = `/v4/spreadsheets/${FINANCE_SPREADSHEET_ID}`;
  return pathname === base || pathname === `${base}/values:batchGet`;
}

export function isFinancePath(pathname) {
  return pathname === '/finance' || pathname === '/finance/' || pathname === '/finance.html';
}

export function injectFinanceSessionBridge(response) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  if (typeof HTMLRewriter === 'undefined') return response;

  return new HTMLRewriter()
    .on('script[src="https://accounts.google.com/gsi/client"]', {
      element(element) {
        element.remove();
      }
    })
    .on('body', {
      element(element) {
        element.append('<script src="/finance-session.js"></script>', { html: true });
      }
    })
    .transform(response);
}

async function validAccessToken(session, env) {
  if (session.accessToken && Number(session.accessExpiresAt) > Date.now() + 60_000) {
    return { session, refreshed: false };
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !session.refreshToken) return null;

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
  try {
    return await decryptJson(value, env.SESSION_SECRET);
  } catch {
    return null;
  }
}

function allowedEmails(env) {
  return new Set(String(env.ALLOWED_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean));
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
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
  if (combined.length <= 12) throw new Error('Cookie non valido.');
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), data);
  return JSON.parse(new TextDecoder().decode(decrypted));
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      ...extraHeaders
    }
  });
}
