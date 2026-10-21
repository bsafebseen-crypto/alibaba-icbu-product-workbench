import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

async function fixture(healthResults) {
  const launcher = await import('../scripts/workbench-launcher.mjs');
  const spawns = [];
  const requests = [];
  const waits = [];
  let healthIndex = 0;
  const options = {
    rootDir: path.resolve('test-launcher-root'),
    port: 54025,
    fetchImpl: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions });
      const healthy = healthResults[Math.min(healthIndex++, healthResults.length - 1)];
      if (!healthy) throw new TypeError('connection refused');
      return new Response('{"ok":true,"background":true}');
    },
    spawnImpl: (executable, args, spawnOptions) => {
      const child = new EventEmitter();
      child.unref = () => { child.unreferenced = true; };
      spawns.push({ executable, args, options: spawnOptions, child });
      return child;
    },
    waitImpl: async (delay) => { waits.push(delay); },
  };
  return { ...launcher, options, spawns, requests, waits };
}

test('launcher detaches the service from the startup console and opens the browser only after readiness', async () => {
  const f = await fixture([false, false, true]);
  await f.startWorkbench(f.options);
  assert.equal(f.spawns.length, 2);
  const service = f.spawns[0];
  assert.equal(service.executable, process.execPath);
  assert.deepEqual(service.args, [path.join(f.options.rootDir, 'src/server.js')]);
  assert.equal(service.options.detached, true);
  assert.equal(service.options.windowsHide, true);
  assert.equal(service.options.stdio, 'ignore');
  assert.equal(service.options.cwd, f.options.rootDir);
  assert.equal(service.options.env.ICBU_WORKBENCH_PORT, '54025');
  assert.equal(service.options.env.ICBU_WORKBENCH_BACKGROUND, '1');
  assert.equal(service.child.unreferenced, true);
  assert.equal(f.spawns[1].executable, 'cmd.exe');
  assert.deepEqual(f.spawns[1].args, ['/d', '/c', 'start', '', 'http://127.0.0.1:54025/']);
  assert.ok(f.requests.every(({ url }) => url === 'http://127.0.0.1:54025/api/health'));
  assert.ok(f.requests.every(({ options }) => options.signal && options.cache === 'no-store'));
  assert.equal(f.waits.length, 1);
});

test('reopening a running workbench never spawns another service', async () => {
  const f = await fixture([true]);
  await f.startWorkbench(f.options);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.spawns[0].executable, 'cmd.exe');
  assert.equal(f.waits.length, 0);
});

test('a running foreground or older server is not falsely reported as an independent background service', async () => {
  const f = await fixture([true]);
  f.options.fetchImpl = async () => new Response('{"ok":true}');
  await assert.rejects(f.startWorkbench(f.options), /前台.*旧.*窗口/);
  assert.equal(f.spawns.length, 0);
});

test('a startup failure never opens the browser or automatically restarts the service', async () => {
  const f = await fixture([false]);
  await assert.rejects(f.startWorkbench(f.options), /data[\\/]runtime[\\/]server\.log/);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.requests.length, 21);
});

test('stopping sends one explicit local shutdown request and never kills a process', async () => {
  const f = await fixture([true]);
  await f.stopWorkbench(f.options);
  assert.equal(f.spawns.length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'http://127.0.0.1:54025/api/workbench/stop');
  assert.equal(f.requests[0].options.method, 'POST');
  assert.equal(f.requests[0].options.headers['x-workbench-control'], 'stop');
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { confirmed: true });
});

test('a shutdown rejected during a write is surfaced without retry or force termination', async () => {
  const f = await fixture([true]);
  let requests = 0;
  f.options.fetchImpl = async () => {
    requests += 1;
    return new Response('{"error":"商品正在写入，请等待完成"}', { status: 409 });
  };
  await assert.rejects(f.stopWorkbench(f.options), /商品正在写入/);
  assert.equal(requests, 1);
  assert.equal(f.spawns.length, 0);
});

test('the stop script requires affirmative confirmation, including when choice is cancelled', async () => {
  const script = await readFile(new URL('../停止工作台.cmd', import.meta.url), 'utf8');
  assert.match(script, /choice[^\r\n]*\r?\nif not "%errorlevel%"=="1" exit \/b 0\r?\nnode scripts\\workbench-launcher\.mjs stop/);
});
