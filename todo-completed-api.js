const SESSION_COOKIE = 'personal_os_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;
const SPREADSHEET_ID = '1E6Lod_d0D0wOv3mrIErpSt9t5ntexGEnW-Ka0e4RXY0';
const TODO_SHEET = 'ToDo';
const COMPLETED_SHEET = 'ToDoCompleted';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';

export async function handleTodoCompletedApi(request, env) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: 'Metodo non consentito.' }, 405, { Allow: 'GET, POST' });
  }
  if (request.method === 'POST') {
    try {
      requireSameOrigin(request);
    } catch (error) {
      return json({ error: error.message }, Number(error.status) || 403);
    }
    const declaredSize = Number(request.headers.get('Content-Length') || 0);
    if (declaredSize > 4096) return json({ error: 'Richiesta troppo grande.' }, 413);
  }

  const session = await getSession(request, env);
  if (!session || !allowedEmails(env).has(session.email)) {
    return json({ error: 'Sessione non valida.' }, 401);
  }

  const tokenResult = await validAccessToken(session, env);
  if (!tokenResult) {
    return json({ error: 'Sessione Google scaduta.' }, 401, {
      'Set-Cookie': clearCookie(SESSION_COOKIE)
    });
  }

  try {
    let payload;
    if (request.method === 'GET') {
      payload = { items: await listCompleted(tokenResult.session.accessToken) };
    } else {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Richiesta non valida.' }, 400);
      }
      const rowNumber = Number(body?.rowNumber);
      const expectedTitle = String(body?.title || '').trim();
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 100000) {
        return json({ error: 'Riga To do non valida.' }, 400);
      }
      payload = {
        item: await archiveTodo(rowNumber, expectedTitle, tokenResult.session.accessToken)
      };
    }

    const headers = {};
    if (tokenResult.refreshed) {
      const updated = await encryptJson(tokenResult.session, env.SESSION_SECRET);
      headers['Set-Cookie'] = cookie(SESSION_COOKIE, updated, SESSION_MAX_AGE);
    }
    return json(payload, 200, headers);
  } catch (error) {
    console.error('Completed ToDo API error', error);
    const status = Number(error?.status) || 502;
    return json({ error: error?.message || 'Errore nello storico To do.' }, status);
  }
}

async function archiveTodo(rowNumber, expectedTitle, accessToken) {
  const meta = await ensureCompletedSheet(accessToken);
  const todoSheet = findSheet(meta, TODO_SHEET);
  if (!todoSheet) throw httpError(404, 'Foglio ToDo non trovato.');

  const active = await getValues(`${TODO_SHEET}!A${rowNumber}:D${rowNumber}`, accessToken);
  const row = (active.values || [])[0] || [];
  if (!row[2]) throw httpError(409, 'To do non trovato. Aggiorna la dashboard e riprova.');
  if (expectedTitle && String(row[2]).trim() !== expectedTitle) {
    throw httpError(409, 'L’elenco To do è cambiato. Aggiorna la dashboard e riprova.');
  }

  const item = {
    id: String(row[0] || stableLegacyId(row)),
    createdAt: String(row[1] || ''),
    completedAt: new Date().toISOString(),
    title: String(row[2] || ''),
    note: String(row[3] || '')
  };

  const existing = await getValues(`${COMPLETED_SHEET}!A2:C`, accessToken);
  const existingRow = (existing.values || []).find(entry => String(entry[0] || '') === item.id);
  if (!existingRow) {
    await appendValues(`${COMPLETED_SHEET}!A:E`, [[
      item.id,
      item.createdAt,
      item.completedAt,
      item.title,
      item.note
    ]], accessToken);
  } else if (existingRow[2]) {
    item.completedAt = String(existingRow[2]);
  }

  await googleJson(`${SHEETS}${SPREADSHEET_ID}:batchUpdate`, accessToken, {
    method: 'POST',
    body: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: todoSheet.sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber
          }
        }
      }]
    }
  });

  return item;
}

async function listCompleted(accessToken) {
  const meta = await spreadsheetMeta(accessToken);
  if (!findSheet(meta, COMPLETED_SHEET)) return [];

  const data = await getValues(`${COMPLETED_SHEET}!A2:E`, accessToken);
  return (data.values || []).map(row => ({
    id: String(row[0] || ''),
    createdAt: String(row[1] || ''),
    completedAt: String(row[2] || ''),
    title: String(row[3] || ''),
    note: String(row[4] || '')
  })).filter(item => item.title).sort((a, b) => {
    const right = Date.parse(b.completedAt) || 0;
    const left = Date.parse(a.completedAt) || 0;
    return right - left;
  });
}

async function ensureCompletedSheet(accessToken) {
  let meta = await spreadsheetMeta(accessToken);
  if (!findSheet(meta, COMPLETED_SHEET)) {
    await googleJson(`${SHEETS}${SPREADSHEET_ID}:batchUpdate`, accessToken, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: COMPLETED_SHEET } } }] }
    });
    meta = await spreadsheetMeta(accessToken);
  }

  const header = await getValues(`${COMPLETED_SHEET}!A1:E1`, accessToken);
  if (!(header.values || []).length) {
    await googleJson(
      `${SHEETS}${SPREADSHEET_ID}/values/${encodeURIComponent(`${COMPLETED_SHEET}!A1:E1`)}?valueInputOption=RAW`,
      accessToken,
      {
        method: 'PUT',
        body: {
          range: `${COMPLETED_SHEET}!A1:E1`,
          majorDimension: 'ROWS',
          values: [['ID', 'CreatedAt', 'CompletedAt', 'Title', 'Note']]
        }
      }
    );
  }
  return meta;
}

async function spreadsheetMeta(accessToken) {
  return googleJson(
    `${SHEETS}${SPREADSHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title,index)')}`,
    accessToken
  );
}

function findSheet(meta, title) {
  const sheet = (meta.sheets || []).find(entry => entry?.properties?.title === title);
  return sheet?.properties || null;
}

async function getValues(range, accessToken) {
  return googleJson(`${SHEETS}${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, accessToken);
}

async function appendValues(range, values, accessToken) {
  return googleJson(
    `${SHEETS}${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    accessToken,
    { method: 'POST', body: { values } }
  );
}

async function googleJson(url, accessToken, options = {}) {
  const headers = new Headers({ Authorization: `Bearer ${accessToken}` });
  const init = { method: options.method || 'GET', headers };
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, body?.error?.message || `Google Sheets HTTP ${response.status}`);
  }
  return body;
}

function stableLegacyId(row) {
  return `legacy:${String(row[1] || '')}:${String(row[2] || '')}`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw httpError(403, 'Origine richiesta non valida.');
  }
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
