const TODO_SPREADSHEET_ID = '1E6Lod_d0D0wOv3mrIErpSt9t5ntexGEnW-Ka0e4RXY0';
const TODO_SHEET = 'ToDo';
const REMINDER_DONE_SHEET = 'ReminderDone';
const CALENDAR_ID = 'f63j9gnmsr08t755hj5s9b8ulo@group.calendar.google.com';

const FINANCE_SPREADSHEET_ID = '1kJn6t--UjFmxZ9q_Y8m8MNjjccmGkqhLiEOPsed4yhY';
const FINANCE_EXPENSES_SHEET = 'Spese 2026';
const FINANCE_BUDGET_SHEET = 'Bdg26_long';
const CANTIERE_CATEGORY = 'Ristrutturazione Marty';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

const TIME_ZONE = 'Europe/Rome';
const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

export async function handleWidget(request, env) {
  if (request.method !== 'GET') return json({ error: 'Metodo non consentito.' }, 405);

  requireConfig(env);
  if (!(await validBearer(request, env.WIDGET_TOKEN))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const accessToken = await serviceAccountAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const [todoData, reminderData, financeData] = await Promise.all([
    loadTodos(accessToken),
    loadReminders(accessToken, env),
    loadFinance(accessToken)
  ]);

  return json({
    version: 1,
    todo: todoData,
    reminder: reminderData,
    finance: financeData,
    updatedAt: new Date().toISOString()
  });
}

function requireConfig(env) {
  const missing = ['WIDGET_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON'].filter(key => !env[key]);
  if (missing.length) throw new Error(`Configurazione widget incompleta: ${missing.join(', ')}`);
}

async function validBearer(request, expected) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const supplied = auth.slice(7).trim();
  if (!supplied || !expected) return false;

  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected)))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function loadTodos(accessToken) {
  const rows = await sheetValues(accessToken, TODO_SPREADSHEET_ID, `${TODO_SHEET}!A2:D`);
  const items = rows
    .map(row => ({
      id: String(row[0] || ''),
      createdAt: String(row[1] || ''),
      title: String(row[2] || '').trim(),
      note: String(row[3] || '').trim()
    }))
    .filter(item => item.title);

  return {
    count: items.length,
    items
  };
}

async function loadReminders(accessToken, env) {
  const doneRows = await sheetValues(accessToken, TODO_SPREADSHEET_ID, `${REMINDER_DONE_SHEET}!A2:B`);
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
  const shared = await googleJson(sharedUrl, accessToken);

  const personalId = personalCalendarId(env);
  let personal = { items: [] };
  let personalConnected = false;
  if (personalId && personalId !== CALENDAR_ID) {
    const personalUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(personalId)}/events?${params}`;
    try {
      personal = await googleJson(personalUrl, accessToken);
      personalConnected = true;
    } catch (error) {
      console.warn(`Personal calendar unavailable for widget: ${String(error?.message || error)}`);
    }
  }

  const visible = mergeCalendarItems(shared.items || [], personal.items || [])
    .filter(event => event.status !== 'cancelled' && event.id && !done.has(event.id))
    .map(event => ({
      id: event.id,
      title: String(event.summary || '(Senza titolo)'),
      note: String(event.description || ''),
      start: event.start?.dateTime || event.start?.date || null,
      allDay: !!(event.start?.date && !event.start?.dateTime)
    }))
    .filter(event => event.start);

  return {
    count: visible.length,
    items: visible,
    sources: {
      shared: true,
      personal: personalConnected
    }
  };
}

function personalCalendarId(env) {
  const explicit = String(env.PERSONAL_CALENDAR_ID || '').trim();
  if (explicit) return explicit;
  return String(env.ALLOWED_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .find(Boolean) || '';
}

function mergeCalendarItems(sharedItems, personalItems) {
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

async function loadFinance(accessToken) {
  const [expenseRows, budgetRows] = await Promise.all([
    sheetValues(accessToken, FINANCE_SPREADSHEET_ID, `'${FINANCE_EXPENSES_SHEET}'!A:Z`),
    sheetValues(accessToken, FINANCE_SPREADSHEET_ID, `'${FINANCE_BUDGET_SHEET}'!A:Z`)
  ]);

  const period = currentPeriod();
  const expenses = summarizeExpenses(expenseRows, period.month);
  const budget = summarizeBudget(budgetRows, period.month);
  const remaining = budget - expenses.total;

  return {
    period: `${period.year}-${String(period.month).padStart(2, '0')}`,
    periodLabel: `${MONTHS_IT[period.month - 1]} ${period.year}`,
    monthExpenses: money(expenses.total),
    monthBudget: money(budget),
    budgetRemaining: money(remaining),
    budgetUsedPct: budget > 0 ? Math.round((expenses.total / budget) * 1000) / 10 : null,
    transactionsThisMonth: expenses.count
  };
}

function summarizeExpenses(rows, targetMonth) {
  const header = findHeader(rows, ['Spesa', 'Importo']);
  if (!header) throw new Error(`Intestazioni non riconosciute in ${FINANCE_EXPENSES_SHEET}.`);

  const iCategory = column(header.map, 'Spesa');
  const iAmount = column(header.map, 'Importo');
  const iMonth = column(header.map, 'Mese');
  const iDate = column(header.map, 'Data');

  let total = 0;
  let count = 0;
  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const category = String(row[iCategory] || '').trim();
    if (!category || sameText(category, CANTIERE_CATEGORY)) continue;

    let month = integer(row[iMonth]);
    if (!(month >= 1 && month <= 12)) month = monthFromGoogleValue(row[iDate]);
    if (month !== targetMonth) continue;

    total += number(row[iAmount]);
    count++;
  }
  return { total, count };
}

function summarizeBudget(rows, targetMonth) {
  const header = findHeader(rows, ['Spesa', 'Budget']);
  if (!header) throw new Error(`Intestazioni non riconosciute in ${FINANCE_BUDGET_SHEET}.`);

  const iCategory = column(header.map, 'Spesa');
  const iBudget = column(header.map, 'Budget');
  const iMonth = column(header.map, 'Mese');
  const iMonthName = column(header.map, 'Mese_nome');

  let total = 0;
  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const category = String(row[iCategory] || '').trim();
    if (!category || sameText(category, CANTIERE_CATEGORY)) continue;

    let month = integer(row[iMonth]);
    if (!(month >= 1 && month <= 12)) {
      const name = normalize(row[iMonthName]);
      month = MONTHS_IT.findIndex(m => normalize(m) === name) + 1;
    }
    if (month !== targetMonth) continue;
    total += number(row[iBudget]);
  }
  return total;
}

function findHeader(rows, required) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] || [];
    const map = new Map();
    row.forEach((value, index) => {
      const key = normalize(value);
      if (key && !map.has(key)) map.set(key, index);
    });
    const ok = required.every(name => column(map, name) !== -1);
    if (ok) return { row: r, map };
  }
  return null;
}

function column(map, name) {
  const wanted = normalize(name);
  if (map.has(wanted)) return map.get(wanted);
  for (const [key, index] of map.entries()) {
    if (key.startsWith(wanted)) return index;
  }
  return -1;
}

function normalize(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function sameText(a, b) {
  return normalize(a) === normalize(b);
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null || value === '') return 0;
  const text = String(value).trim();
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  return Math.round(number(value));
}

function monthFromGoogleValue(value) {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return date.getUTCMonth() + 1;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getMonth() + 1;
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return { year, month };
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

async function serviceAccountAccessToken(rawCredentials) {
  let credentials;
  try {
    credentials = JSON.parse(String(rawCredentials));
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non contiene JSON valido.');
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service account incompleto: mancano client_email o private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (credentials.private_key_id) header.kid = credentials.private_key_id;
  const claims = {
    iss: credentials.client_email,
    scope: GOOGLE_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64urlText(JSON.stringify(header))}.${base64urlText(JSON.stringify(claims))}`;
  const key = await importPrivateKey(credentials.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Google OAuth HTTP ${response.status}`);
  }
  return body.access_token;
}

async function importPrivateKey(pem) {
  const normalized = String(pem).replace(/\\n/g, '\n');
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(body), char => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64urlText(text) {
  return base64url(new TextEncoder().encode(text));
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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
