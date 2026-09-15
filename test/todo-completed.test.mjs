import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTodoCompletedApi } from '../todo-completed-api.js';
import workerEntry from '../worker-entry.js';

const ORIGIN = 'https://family-expenses.gs-ravanetti.workers.dev';

test('completed todo API rejects unauthenticated reads', async () => {
  const response = await handleTodoCompletedApi(
    new Request(`${ORIGIN}/api/todo-completed`),
    {}
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Sessione non valida.' });
});

test('completed todo API rejects cross-origin writes before authentication', async () => {
  const response = await handleTodoCompletedApi(
    new Request(`${ORIGIN}/api/todo-completed`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rowNumber: 2 })
    }),
    {}
  );
  assert.equal(response.status, 403);
});

test('completed todo API only allows GET and POST', async () => {
  const response = await handleTodoCompletedApi(
    new Request(`${ORIGIN}/api/todo-completed`, { method: 'DELETE' }),
    {}
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
});

test('worker entry routes completed todo API and adds security headers', async () => {
  const response = await workerEntry.fetch(
    new Request(`${ORIGIN}/api/todo-completed`),
    {}
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});
