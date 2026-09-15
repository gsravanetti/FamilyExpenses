import { handleWidget } from './widget.js';

const SESSION_COOKIE = 'personal_os_session';
const TODO_SPREADSHEET_ID = '1E6Lod_d0D0wOv3mrIErpSt9t5ntexGEnW-Ka0e4RXY0';
const REMINDER_DONE_SHEET = 'ReminderDone';
const CALENDAR_ID = 'f63j9gnmsr08t755hj5s9b8ulo@group.calendar.google.com';
const MAX_CREDENTIAL_AGE = 60 * 60 * 24 * 180 * 1000;

export async function handleUnifiedWidget(request, env) {
  if (request.method !== 'GET') return json({ error: 'Metodo non consentito.' }, 405);

  const bearer = bearerToken(request);
  if (!bearer) return json({ error: 'Unauthorized' }, 401);

  // Backward-compatible fallback: the old WIDGET_TOKEN still works,
  // but Calendar will be read through the service account and therefore
  // cannot be guaranteed to match the signed-in Dashboard user.
  if (await secureEqual(bearer, String(env.WIDGET_TOKEN || ''))) {
    return handleWidget(request, env);
  }

  const widgetSession = await widgetSessionFromCredential(bearer, env);
  if (!widgetSession) return json({ error: 'Credenziale widget non valida o scaduta.' }, 401);

  const tokenResult = await validAccessToken(widgetSession, env);
  if (!tokenResult) return json({ error: 'Autorizzazione Google del widget scaduta.' }, 401);

  // Keep the existing, audited service-account path for To do + Finance.
  const baseRequest = new Request(request.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.WIDGET_TOKEN}`,
      Accept: 'application/json'
    }
  });
  const baseResponse = await handleWidget(baseRequest, env);
  if (!baseResponse.ok) return baseResponse;

  const payload = await baseResponse.json();

  // Calendar instead uses the exact Google identity used by the Dashboard.
  payload.reminder = await loadUserReminders(tokenResult.session.accessToken);
  payload.calendarSource = 'user-oauth';
  payload.calendarUser = tokenResult.session.email;
  payload.updatedAt = new Date().toISOString();

  return json(payload);
}

export async function handleWidgetCredential(request, env) {
  if (request.method !== 'GET') return json({ error: 'Metodo non consentito.' }, 405);
  if (!env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return htmlMessage('Configurazione incompleta', 'Mancano le credenziali necessarie sul Worker.', 500);
  }

  const cookieValue = readCookie(request, SESSION_COOKIE);
  if (!cookieValue) {
    return htmlMessage(
      'Accedi prima alla Dashboard',
      'Apri la Dashboard, effettua il login Google e poi torna su questa pagina.',
      401
    );
  }

  let session;
  try {
    session = await decryptJson(cookieValue, env.SESSION_SECRET);
  } catch {
    return htmlMessage('Sessione non valida', 'Esci dalla Dashboard e accedi di nuovo con Google.', 401);
  }

  const email = String(session?.email || '').trim().toLowerCase();
  if (!email || !allowedEmails(env).has(email) || !session?.refreshToken) {
    return htmlMessage('Sessione non autorizzata', 'L’account Google corrente non può creare la credenziale widget.', 403);
  }

  const tokenResult = await validAccessToken(session, env);
  if (!tokenResult) {
    return htmlMessage('Sessione Google scaduta', 'Esci dalla Dashboard e accedi di nuovo con Google.', 401);
  }

  const credential = await encryptJson({
    type: 'personal-os-widget-calendar-v1',
    email: tokenResult.session.email,
    refreshToken: tokenResult.session.refreshToken,
    accessToken: tokenResult.session.accessToken,
    accessExpiresAt: tokenResult.session.accessExpiresAt,
    issuedAt: Date.now()
  }, widgetSecret(env));

  return credentialPage(credential, email);
}

async function widgetSessionFromCredential(value, env) {
  if (!env.SESSION_SECRET) return null;
  try {
    const data = await decryptJson(value, widgetSecret(env));
    if (data?.type !== 'personal-os-widget-calendar-v1') return null;
    const email = String(data.email || '').trim().toLowerCase();
    if (!email || !allowedEmails(env).has(email)) return null;
    if (!data.refreshToken || !data.issuedAt) return null;
    if (Date.now() - Number(data.issuedAt) > MAX_CREDENTIAL_AGE) return null;
    return data;
  } catch {
    return null;
  }
}

async function loadUserReminders(accessToken) {
  const doneRows = await sheetValues(
    accessToken,
    TODO_SPREADSHEET_ID,
    `${REMINDER_DONE_SHEET}!A2:B`
  );
  const done = new Set(doneRows.map(row => String(row[0] || '')).filter(Boolean));

  const now = new Date();
  const future = new Date(now.getTime() + 365 * 86400000);
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
    maxResults: '250',
    timeMin: now.toISOString(),
    timeMax: future.toISOString()
  });

  const sharedUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`;
  const personalUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;

  const [shared, personal, colors, sharedCalendar, personalCalendar] = await Promise.all([
    googleJson(sharedUrl, accessToken),
    googleJson(personalUrl, accessToken),
    calendarColorsJson(accessToken),
    calendarListEntry(CALENDAR_ID, accessToken),
    calendarListEntry('primary', accessToken)
  ]);

  const sharedItems = decorateCalendarEvents(
    shared.items || [],
    'shared',
    sharedCalendar,
    colors,
    '#039BE5'
  );
  const personalItems = decorateCalendarEvents(
    personal.items || [],
    'personal',
    personalCalendar,
    colors,
    '#7986CB'
  );

  // Deliberately mirror worker.js / Dashboard: shared first, personal second,
  // first copy wins for the same iCalUID + start.
  const items = mergeLikeDashboard(sharedItems, personalItems);

  const visible = items
    .filter(event => event.status !== 'cancelled' && event.id && !done.has(event.id))
    .map(event => ({
      id: event.id,
      title: String(event.summary || '(Senza titolo)'),
      note: String(event.description || ''),
      start: event.start?.dateTime || event.start?.date || null,
      allDay: !!(event.start?.date && !event.start?.dateTime),
      color: event.personalOSColor,
      personalOSColor: event.personalOSColor,
      calendar: event.personalOSCalendar
    }))
    .filter(event => event.start);

  return {
    count: visible.length,
    items: visible,
    sources: {
      shared: true,
      personal: true,
      userOAuth: true
    }
  };
}

function decorateCalendarEvents(items, source, calendar, colors, fallbackColor) {
  const calendarColor = normalizeCalendarColor(
    calendar?.backgroundColor || colors?.calendar?.[calendar?.colorId]?.background,
    fallbackColor
  );

  return items.map(event => ({
    ...event,
    personalOSCalendar: source,
    personalOSColor: normalizeCalendarColor(
      colors?.event?.[event?.colorId]?.background,
      calendarColor
    )
  }));
}

function mergeLikeDashboard(sharedItems, personalItems) {
  const seen = new Set();
  const items = [];

  for (const event of [...sharedItems, ...personalItems]) {
    const start = event?.start?.dateTime || event?.start?.date || '';
    const key = event?.iCalUID
      ? `ical:${event.iCalUID}|${start}`
      : `event:${event?.id || ''}|${start}|${event?.summary || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(event);
  }

  items.sort((a, b) => calendarEventStartValue(a) - calendarEventStartValue(b));
  return items;
}

function calendarEventStartValue(event) {
  const raw = event?.start?.dateTime || event?.start?.date;
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const value = Date.parse(raw);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function normalizeCalendarColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

async function calendarColorsJson(accessToken) {
  try {
    return await googleJson('https://www.googleapis.com/calendar/v3/colors', accessToken);
  } catch {
    return { calendar: {}, event: {} };
  }
}

async function calendarListEntry(calendarId, accessToken) {
  const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}?colorRgbFormat=true`;
  try {
    return await googleJson(url, accessToken);
  } catch {
    return null;
  }
}

async function sheetValues(accessToken, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const data = await googleJson(url, accessToken);
  return data.values || [];
}

async function googleJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Google API HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function validAccessToken(session, env) {
  if (session.accessToken && Number(session.accessExpiresAt) > Date.now() + 60_000) {
    return { session, refreshed: false };
  }

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

  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token) return null;

  session.accessToken = tokens.access_token;
  session.accessExpiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return { session, refreshed: true };
}

function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function secureEqual(a, b) {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const [aa, bb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b))
  ]);
  const x = new Uint8Array(aa);
  const y = new Uint8Array(bb);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function allowedEmails(env) {
  return new Set(
    String(env.ALLOWED_EMAILS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
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

function widgetSecret(env) {
  return `${env.SESSION_SECRET}:personal-os-widget-calendar-v1`;
}

async function encryptionKey(secret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    data
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return base64url(combined);
}

async function decryptJson(value, secret) {
  const combined = fromBase64url(value);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    data
  );
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

function credentialPage(credential, email) {
  const escapedCredential = escapeHtml(credential);
  const escapedEmail = escapeHtml(email);
  return new Response(`<!doctype html>
<html lang="it">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Collega Widget</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f7fb;color:#172033;margin:0;padding:24px}.card{max-width:680px;margin:8vh auto;background:white;border:1px solid #dbe3f0;border-radius:24px;padding:24px;box-shadow:0 16px 50px #31446b18}h1{margin:0 0 8px;font-size:26px}p{color:#64748b;line-height:1.45}textarea{width:100%;box-sizing:border-box;min-height:130px;border:1px solid #cbd5e1;border-radius:14px;padding:12px;font:12px ui-monospace,SFMono-Regular,monospace;resize:none}button{margin-top:14px;width:100%;border:0;border-radius:14px;background:#2563eb;color:white;font-weight:800;font-size:16px;padding:14px}.ok{margin-top:12px;color:#059669;font-weight:700;min-height:22px}
</style>
<div class="card">
<h1>Collega il widget</h1>
<p>Account: <strong>${escapedEmail}</strong>. Copia questa credenziale cifrata e incollala in Scriptable quando richiesta. Non contiene la password Google in chiaro.</p>
<textarea id="credential" readonly>${escapedCredential}</textarea>
<button id="copy">Copia credenziale</button>
<div class="ok" id="status"></div>
</div>
<script>
document.getElementById('copy').onclick=async()=>{const t=document.getElementById('credential');try{await navigator.clipboard.writeText(t.value);document.getElementById('status').textContent='Copiata. Ora apri Scriptable.';}catch(e){t.select();document.execCommand('copy');document.getElementById('status').textContent='Copiata. Ora apri Scriptable.';}};
</script>
</html>`, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function htmlMessage(title, message, status) {
  return new Response(`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;padding:32px;max-width:650px;margin:auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Torna alla Dashboard</a></p></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
