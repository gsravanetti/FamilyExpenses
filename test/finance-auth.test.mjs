import test from 'node:test';
import assert from 'node:assert/strict';
import workerEntry from '../worker-entry.js';
import {
  isAllowedFinanceTarget,
  isFinancePath
} from '../finance-auth.js';

const ORIGIN = 'https://family-expenses.gs-ravanetti.workers.dev';
const FINANCE_SHEET_ID = '1kJn6t--UjFmxZ9q_Y8m8MNjjccmGkqhLiEOPsed4yhY';

test('Finance proxy accepts only read-only endpoints for the configured sheet', () => {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${FINANCE_SHEET_ID}`;
  assert.equal(isAllowedFinanceTarget(new URL(`${base}?fields=sheets.properties.title`), 'GET'), true);
  assert.equal(isAllowedFinanceTarget(new URL(`${base}/values:batchGet?ranges=Spese%202026`), 'GET'), true);
  assert.equal(isAllowedFinanceTarget(new URL(`${base}/values/Spese%202026!A1:Z99`), 'GET'), false);
  assert.equal(isAllowedFinanceTarget(new URL(`${base}:batchUpdate`), 'POST'), false);
  assert.equal(isAllowedFinanceTarget(new URL('https://sheets.googleapis.com/v4/spreadsheets/another-sheet'), 'GET'), false);
  assert.equal(isAllowedFinanceTarget(new URL(`${base.replace('https://', 'https://user:pass@')}`), 'GET'), false);
});

test('Finance page aliases are recognized for session bridge injection', () => {
  assert.equal(isFinancePath('/finance'), true);
  assert.equal(isFinancePath('/finance/'), true);
  assert.equal(isFinancePath('/finance.html'), true);
  assert.equal(isFinancePath('/'), false);
  assert.equal(isFinancePath('/finance-other'), false);
});

test('Finance API requires the shared authenticated session', async () => {
  const response = await workerEntry.fetch(
    new Request(`${ORIGIN}/api/finance?url=${encodeURIComponent(`https://sheets.googleapis.com/v4/spreadsheets/${FINANCE_SHEET_ID}`)}`),
    {},
    {}
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Sessione non valida.' });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('Finance API is read-only', async () => {
  const response = await workerEntry.fetch(
    new Request(`${ORIGIN}/api/finance`, { method: 'POST' }),
    {},
    {}
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});
