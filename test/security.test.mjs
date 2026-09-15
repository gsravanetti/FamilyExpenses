import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  isAllowedGoogleTarget,
  requireSameOrigin,
  safeReturnTo,
  withSecurityHeaders
} from '../worker.js';
import workerEntry from '../worker-entry.js';

const ORIGIN = 'https://family-expenses.gs-ravanetti.workers.dev';
const SHEET_ID = '1E6Lod_d0D0wOv3mrIErpSt9t5ntexGEnW-Ka0e4RXY0';
const CALENDAR_ID = 'f63j9gnmsr08t755hj5s9b8ulo@group.calendar.google.com';

test('returnTo accepts only local paths', () => {
  assert.equal(safeReturnTo('/finance?view=year#top'), '/finance?view=year#top');
  assert.equal(safeReturnTo('//evil.example'), '/');
  assert.equal(safeReturnTo('/\\evil.example'), '/');
  assert.equal(safeReturnTo('https://evil.example'), '/');
  assert.equal(safeReturnTo('/ok\nLocation: https://evil.example'), '/');
});

test('Google proxy is limited to the configured calendar', () => {
  const allowed = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
  assert.equal(isAllowedGoogleTarget(allowed, 'GET'), true);
  assert.equal(isAllowedGoogleTarget(allowed, 'POST'), true);
  assert.equal(isAllowedGoogleTarget(allowed, 'DELETE'), false);
  assert.equal(isAllowedGoogleTarget(new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events'), 'GET'), false);
  assert.equal(isAllowedGoogleTarget(new URL('https://evil.example/calendar/v3/'), 'GET'), false);
});

test('Google proxy is limited to the configured spreadsheet and methods', () => {
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`), 'GET'), true);
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`), 'POST'), true);
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/ToDo%21A2%3AD`), 'GET'), true);
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/ToDo%21A%3AD:append`), 'POST'), true);
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/PrivateTab%21A1%3AD`), 'GET'), false);
  assert.equal(isAllowedGoogleTarget(new URL('https://sheets.googleapis.com/v4/spreadsheets/another-sheet/values/A1'), 'GET'), false);
  assert.equal(isAllowedGoogleTarget(new URL(`https://sheets.googleapis.com:444/v4/spreadsheets/${SHEET_ID}`), 'GET'), false);
});

test('state-changing requests require the exact Origin', () => {
  assert.doesNotThrow(() => requireSameOrigin(new Request(`${ORIGIN}/api/google`, {
    method: 'POST',
    headers: { Origin: ORIGIN }
  })));
  assert.throws(() => requireSameOrigin(new Request(`${ORIGIN}/api/google`, { method: 'POST' })), /Origine/);
  assert.throws(() => requireSameOrigin(new Request(`${ORIGIN}/api/google`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' }
  })), /Origine/);
});

test('security headers are added to every response', () => {
  const response = withSecurityHeaders(new Response('ok'));
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('HTTP is redirected before static assets are served', async () => {
  const response = await worker.fetch(new Request('http://family-expenses.gs-ravanetti.workers.dev/'), {
    ASSETS: { fetch: () => { throw new Error('assets should not be called'); } }
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), `${ORIGIN}/`);
});

test('cross-origin logout is rejected with 403', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' }
  }), {});
  assert.equal(response.status, 403);
});

test('static responses receive security headers', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/`), {
    ASSETS: { fetch: () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('widget endpoint rejects missing bearer token and receives security headers', async () => {
  const response = await workerEntry.fetch(new Request(`${ORIGIN}/api/widget`), {
    WIDGET_TOKEN: 'test-token',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{}'
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('widget errors do not expose configuration details', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await workerEntry.fetch(new Request(`${ORIGIN}/api/widget`), {});
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Errore interno widget.' });
  } finally {
    console.error = originalError;
  }
});
