import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

async function fixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-stop-'));
  const server = createServer({ rootDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('shutdown rejects browser-origin and unconfirmed requests while keeping the service available', async () => {
  const { server, baseUrl } = await fixture();
  try {
    for (const [headers, body, status] of [
      [{ 'Content-Type': 'application/json' }, { confirmed: true }, 403],
      [{ 'Content-Type': 'application/json', 'x-workbench-control': 'stop', Origin: 'https://example.com' }, { confirmed: true }, 403],
      [{ 'Content-Type': 'application/json', 'x-workbench-control': 'stop' }, {}, 400],
    ]) {
      const response = await fetch(`${baseUrl}/api/workbench/stop`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, status);
      assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an explicitly confirmed local shutdown closes the listener without force killing anything', async () => {
  const { server, baseUrl } = await fixture();
  const closed = once(server, 'close');
  try {
    const response = await fetch(`${baseUrl}/api/workbench/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workbench-control': 'stop' },
      body: '{"confirmed":true}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, stopping: true });
    await closed;
    assert.equal(server.listening, false);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
