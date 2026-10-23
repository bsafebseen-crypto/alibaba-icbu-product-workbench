import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

const imageHeaders = { 'Content-Type': 'application/json', 'X-Image-Tools': '1' };

function fixture() {
  const calls = [];
  const state = {
    runtime: { available: true, message: '图片处理环境已就绪' },
    selection: { id: 'native-selection', folder: 'C:\\synthetic images', count: 2 },
    job: null,
  };
  return {
    calls, state,
    getState: async () => { calls.push(['state']); return state; },
    selectFolder: async () => { calls.push(['select']); return state; },
    start: async (id) => { calls.push(['start', id]); return state; },
    openFolder: async (id) => { calls.push(['open', id]); return { ok: true }; },
    isBusy: () => false,
  };
}

async function withServer(run, imageTools = fixture()) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-image-http-'));
  const server = createServer({ rootDir, imageTools });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, imageTools);
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

test('image tools routes use the existing server and only pass native selection ids to processing', async () => {
  await withServer(async (base, service) => {
    let response = await fetch(`${base}/api/image-tools/state`, { headers: imageHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), service.state);
    response = await fetch(`${base}/api/image-tools/select`, {
      method: 'POST', headers: imageHeaders, body: '{}',
    });
    assert.equal(response.status, 200);
    response = await fetch(`${base}/api/image-tools/start`, {
      method: 'POST', headers: imageHeaders,
      body: JSON.stringify({ selectionId: 'native-selection', folder: 'C:\\not-selected' }),
    });
    assert.equal(response.status, 202);
    response = await fetch(`${base}/api/image-tools/open`, {
      method: 'POST', headers: imageHeaders,
      body: JSON.stringify({ selectionId: 'native-selection' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(service.calls, [['state'], ['select'], ['start', 'native-selection'], ['open', 'native-selection']]);
  });
});

test('image tools reject missing custom headers and hostile origins before any local operation', async () => {
  await withServer(async (base, service) => {
    const cases = [
      { 'Content-Type': 'application/json' },
      { ...imageHeaders, Origin: 'https://untrusted.example' },
      { ...imageHeaders, Origin: 'null' },
      { ...imageHeaders, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of cases) {
      const response = await fetch(`${base}/api/image-tools/select`, {
        method: 'POST', headers, body: '{}',
      });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(service.calls, []);
    const allowed = await fetch(`${base}/api/image-tools/state`, {
      headers: { ...imageHeaders, Origin: base },
    });
    assert.equal(allowed.status, 200);
  });
});

test('image tools reject a non-loopback Host even when it points at the local socket', async () => {
  await withServer(async (base, service) => {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(`${base}/api/image-tools/state`, {
        headers: { ...imageHeaders, Host: 'rebound.example' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 403);
    assert.deepEqual(service.calls, []);
  });
});

test('image tools reject form posts and invalid JSON without launching the picker', async () => {
  await withServer(async (base, service) => {
    const form = await fetch(`${base}/api/image-tools/select`, {
      method: 'POST', headers: { ...imageHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'folder=anything',
    });
    assert.equal(form.status, 415);
    const malformed = await fetch(`${base}/api/image-tools/select`, {
      method: 'POST', headers: imageHeaders, body: '{',
    });
    assert.equal(malformed.status, 400);
    for (const body of ['null', '[]', '"folder"']) {
      const response = await fetch(`${base}/api/image-tools/select`, {
        method: 'POST', headers: imageHeaders, body,
      });
      assert.equal(response.status, 400);
    }
    assert.deepEqual(service.calls, []);
  });
});

test('image tools preserve validation errors and keep other local endpoints available', async () => {
  const service = fixture();
  service.start = async () => { throw Object.assign(new Error('请重新选择图片文件夹'), { status: 409 }); };
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/image-tools/start`, {
      method: 'POST', headers: imageHeaders, body: JSON.stringify({ selectionId: 'expired' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, '请重新选择图片文件夹');
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  }, service);
});

test('normal shutdown refuses to interrupt an active image replacement', async () => {
  const service = fixture();
  service.isBusy = () => true;
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/workbench/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workbench-Control': 'stop' },
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /图片/);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  }, service);
});
