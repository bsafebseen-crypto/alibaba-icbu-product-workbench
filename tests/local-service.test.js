import test from 'node:test';
import assert from 'node:assert/strict';

async function setup(fetchImpl) {
  const { initLocalServiceConnection } = await import('../public/local-service.js');
  const classes = () => {
    const values = new Set();
    return {
      toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
      contains(name) { return values.has(name); },
    };
  };
  const topState = { classList: classes() };
  const local = { textContent: '', closest: () => topState };
  const sidebar = { classList: classes(), lastElementChild: { textContent: '' } };
  const timers = [];
  const documentRef = { getElementById: (id) => (id === 'service-state' ? sidebar : local) };
  const windowRef = { setInterval(callback, delay) { timers.push({ callback, delay }); } };
  const client = initLocalServiceConnection({ fetchImpl, documentRef, windowRef });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  return { ...client, local, sidebar, topState, timers, settle };
}

test('heartbeat removes both green indicators on disconnect and restores them on recovery', async () => {
  let online = true;
  const requests = [];
  const ui = await setup(async (url, options) => {
    requests.push({ url, options });
    if (!online) throw new TypeError('Failed to fetch');
    return new Response('{"ok":true}');
  });
  assert.equal(ui.local.textContent, '已连接');
  assert.equal(ui.sidebar.classList.contains('connected'), true);
  assert.equal(ui.topState.classList.contains('connected'), true);
  assert.equal(ui.timers.length, 1);
  assert.equal(ui.timers[0].delay, 5000);

  online = false;
  await ui.timers[0].callback();
  assert.equal(ui.local.textContent, '未连接');
  assert.equal(ui.sidebar.classList.contains('connected'), false);
  assert.equal(ui.topState.classList.contains('connected'), false);
  assert.match(ui.sidebar.lastElementChild.textContent, /未连接/);

  online = true;
  await ui.timers[0].callback();
  assert.equal(ui.local.textContent, '已连接');
  assert.equal(ui.topState.classList.contains('connected'), true);
  assert.ok(requests.every(({ url }) => url === '/api/health'));
  assert.ok(requests.every(({ options }) => options.cache === 'no-store' && options.signal));
});

test('a failed write immediately marks offline, warns against duplicate submission and is never retried', async () => {
  const writes = [];
  const ui = await setup(async (url, options) => {
    if (url === '/api/health') return new Response('{"ok":true}');
    writes.push({ url, options });
    throw new TypeError('Failed to fetch');
  });
  const options = { method: 'POST', body: '{"planId":"plan-2"}' };
  await assert.rejects(ui.requestJson('/api/obsidian/publication', options), (error) => {
    assert.match(error.message, /本地服务.*连接/);
    assert.match(error.message, /重新打开.*国际站运营工作台/);
    assert.match(error.message, /勿重复/);
    assert.equal(error.cause.message, 'Failed to fetch');
    assert.equal(error.localServiceUnavailable, true);
    return true;
  });
  assert.equal(ui.local.textContent, '未连接');
  assert.equal(ui.topState.classList.contains('connected'), false);
  await ui.timers[0].callback();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.body, options.body);
  assert.equal(writes[0].options.method, 'POST');
});

test('an HTTP business rejection preserves status and reconciliation metadata instead of reporting offline', async () => {
  const ui = await setup(async (url) => (
    url === '/api/health'
      ? new Response('{"ok":true}')
      : new Response(JSON.stringify({ error: 'Invalid field', code: 'BAD_FIELD', requestId: 'request-1', uncertain: true }), { status: 422 })
  ));
  await assert.rejects(ui.requestJson('/api/obsidian/publication', { method: 'POST' }), (error) => {
    assert.equal(error.message, 'Invalid field');
    assert.equal(error.status, 422);
    assert.equal(error.code, 'BAD_FIELD');
    assert.equal(error.requestId, 'request-1');
    assert.equal(error.uncertain, true);
    return true;
  });
  assert.equal(ui.local.textContent, '已连接');
});

test('a stalled health request times out, marks offline and permits the next probe', async () => {
  let stalled = false;
  const ui = await setup(async (_url, options) => {
    if (!stalled) return new Response('{"ok":true}');
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });
  stalled = true;
  // Keep the event loop alive while AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await ui.timers[0].callback();
    assert.equal(ui.local.textContent, '未连接');
    stalled = false;
    await ui.timers[0].callback();
    assert.equal(ui.local.textContent, '已连接');
  } finally {
    clearTimeout(keepAlive);
  }
});

test('health probes do not overlap while a previous probe is pending', async () => {
  let resolveProbe;
  let count = 0;
  const ui = await setup(() => {
    count += 1;
    return new Promise((resolve) => { resolveProbe = resolve; });
  });
  await ui.timers[0].callback();
  assert.equal(count, 1);
  resolveProbe(new Response('{"ok":true}'));
  await ui.settle();
  const next = ui.timers[0].callback();
  assert.equal(count, 2);
  resolveProbe(new Response('{"ok":true}'));
  await next;
});

test('unsuccessful health payloads and HTTP health failures never leave the indicator green', async () => {
  let response = () => new Response('{"ok":true}');
  const ui = await setup(async () => response());
  response = () => new Response('{"ok":false}');
  await ui.timers[0].callback();
  assert.equal(ui.local.textContent, '未连接');
  response = () => new Response('{"error":"unavailable"}', { status: 503 });
  await ui.timers[0].callback();
  assert.equal(ui.topState.classList.contains('connected'), false);
});
