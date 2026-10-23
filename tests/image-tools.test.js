import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { createImageToolsService } from '../src/image-tools.js';

const ready = { type: 'ready', python: '3.14.3', pillow: '12.1.1' };
const folder = path.join(tmpdir(), '图片 sample & literal');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(actions = {}) {
  const calls = [];
  const service = createImageToolsService({
    runPython: async (action, payload, onEvent) => {
      calls.push({ action, payload });
      if (actions[action]) return actions[action](payload, onEvent);
      if (action === 'check') return ready;
      if (action === 'select') return { type: 'selection', folder, count: 2 };
      if (action === 'open') return { type: 'opened' };
      return { type: 'result', folder, completed: 2, skipped: [] };
    },
  });
  return { service, calls };
}

async function settle(service) {
  for (let turn = 0; turn < 20; turn += 1) {
    await nextTurn();
    const state = await service.getState();
    if (state.job?.status !== 'running') return state;
  }
  assert.fail('image job did not settle');
}

test('image runtime is checked lazily once and state polling does not start work', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(calls, []);
  assert.equal(service.isBusy(), false);
  const state = await service.getState();
  assert.equal(state.runtime.available, true);
  assert.equal(state.selection, null);
  assert.equal(state.job, null);
  await service.getState();
  assert.deepEqual(calls.map(({ action }) => action), ['check']);
});

test('a canceled native folder picker preserves selection and completed job', async () => {
  let canceled = false;
  const { service } = fixture({ select: () => ({ type: 'selection', folder: canceled ? null : folder, count: 2 }) });
  const selected = await service.selectFolder();
  assert.equal(selected.selection.folder, folder);
  assert.equal(selected.selection.count, 2);
  assert.match(selected.selection.id, /^[\da-f-]{36}$/i);
  await service.start(selected.selection.id);
  const completed = await settle(service);
  canceled = true;
  assert.deepEqual(await service.selectFolder(), completed);
  canceled = false;
  const reselected = await service.selectFolder();
  assert.notEqual(reselected.selection.id, selected.selection.id);
  assert.equal(reselected.job, null);
});

test('image processing reports progress and terminal result independently of polling', async () => {
  const pending = deferred();
  let report;
  const { service, calls } = fixture({
    process: async (payload, onEvent) => {
      assert.deepEqual(payload, { folder });
      report = onEvent;
      return pending.promise;
    },
  });
  const selected = await service.selectFolder();
  const started = await service.start(selected.selection.id);
  assert.equal(started.job.status, 'running');
  assert.equal(started.job.result, null);
  assert.equal(service.isBusy(), true);
  await nextTurn();
  report({ type: 'progress', done: 1, total: 2, name: '产品2.png' });
  assert.deepEqual((await service.getState()).job.progress, { done: 1, total: 2, name: '产品2.png' });
  pending.resolve({ type: 'result', folder, completed: 1, skipped: [['产品10.png', '损坏']] });
  const completed = await settle(service);
  assert.equal(completed.job.id, started.job.id);
  assert.equal(completed.job.status, 'completed');
  assert.deepEqual(completed.job.result, { folder, completed: 1, skipped: [['产品10.png', '损坏']] });
  assert.equal(completed.job.error, '');
  assert.equal(service.isBusy(), false);
  assert.equal(calls.filter(({ action }) => action === 'process').length, 1);
});

test('start and open reject arbitrary paths and unknown selection tokens', async () => {
  const { service, calls } = fixture();
  for (const value of [undefined, '', folder, 'unknown']) {
    await assert.rejects(service.start(value), { status: 400 });
    await assert.rejects(service.openFolder(value), { status: 400 });
  }
  assert.equal(calls.some(({ action }) => ['process', 'open'].includes(action)), false);
});

test('a native picker serializes folder selection and processing', async () => {
  const pending = deferred();
  const { service } = fixture({ select: () => pending.promise });
  const selecting = service.selectFolder();
  assert.equal(service.isBusy(), true);
  await assert.rejects(service.selectFolder(), { status: 409 });
  await assert.rejects(service.start('unknown'), { status: 409 });
  pending.resolve({ type: 'selection', folder, count: 2 });
  const selected = await selecting;
  assert.equal(selected.selection.folder, folder);
  assert.equal(service.isBusy(), false);
});

test('a running job rejects duplicate starts and folder changes, and a completed token stays consumed', async () => {
  const pending = deferred();
  const { service, calls } = fixture({ process: () => pending.promise });
  const { selection } = await service.selectFolder();
  await service.start(selection.id);
  await assert.rejects(service.start(selection.id), { status: 409 });
  await assert.rejects(service.selectFolder(), { status: 409 });
  pending.resolve({ type: 'result', folder, completed: 2, skipped: [] });
  await settle(service);
  await assert.rejects(service.start(selection.id), { status: 409 });
  assert.deepEqual(await service.openFolder(selection.id), { ok: true });
  assert.deepEqual(calls.at(-1), { action: 'open', payload: { folder } });
  assert.equal(calls.filter(({ action }) => action === 'process').length, 1);
});

test('process failure is terminal and never retries the consumed selection', async () => {
  const { service, calls } = fixture({ process: () => { throw new Error('处理失败，原图片已恢复'); } });
  const { selection } = await service.selectFolder();
  await service.start(selection.id);
  const state = await settle(service);
  assert.equal(state.job.status, 'failed');
  assert.equal(state.job.error, '处理失败，原图片已恢复');
  assert.equal(state.job.result, null);
  assert.equal(service.isBusy(), false);
  await assert.rejects(service.start(selection.id), { status: 409 });
  assert.equal(calls.filter(({ action }) => action === 'process').length, 1);
});

test('missing Python dependencies leave the workbench available and explain local installation', async () => {
  const { service, calls } = fixture({ check: () => { throw new Error('No module named PIL'); } });
  const state = await service.getState();
  assert.equal(state.runtime.available, false);
  assert.match(state.runtime.message, /Python/);
  assert.match(state.runtime.message, /Pillow/);
  assert.match(state.runtime.message, /requirements\.txt/);
  await assert.rejects(service.selectFolder(), { status: 503 });
  assert.equal(service.isBusy(), false);
  assert.deepEqual(calls.map(({ action }) => action), ['check']);
});

test('an empty selected folder is reported without starting an image transaction', async () => {
  const { service, calls } = fixture({ select: () => ({ type: 'selection', folder, count: 0 }) });
  const state = await service.selectFolder();
  assert.equal(state.selection.count, 0);
  await assert.rejects(service.start(state.selection.id), { status: 400 });
  assert.equal(calls.some(({ action }) => action === 'process'), false);
});

const bridgeFile = fileURLToPath(new URL('../tools/image-batch/bridge.py', import.meta.url));

function execute(executable, args, options = {}) {
  return new Promise((resolve, reject) => execFile(executable, args, {
    windowsHide: true, encoding: 'utf8', ...options,
  }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout)));
}

async function pythonRuntime() {
  const candidates = process.platform === 'win32' ? [['py', '-3'], ['python']] : [['python3'], ['python']];
  for (const [executable, ...prefix] of candidates) {
    try {
      await execute(executable, [...prefix, '-c', 'import PIL, tkinter; import sys; assert sys.version_info >= (3, 10)']);
      return { executable, prefix };
    } catch { /* Python is optional for the workbench. */ }
  }
  return null;
}

function bridge(runtime, action, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.executable, [...runtime.prefix, '-X', 'utf8', bridgeFile, action], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, events: stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse), stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('the real bridge processes only synthetic images through Unicode and spaced stdin paths', async (t) => {
  const runtime = await pythonRuntime();
  if (!runtime) return t.skip('optional Python/Pillow/tkinter runtime unavailable');
  const directory = await mkdtemp(path.join(tmpdir(), '图片 bridge & space '));
  try {
    await execute(runtime.executable, [...runtime.prefix, '-X', 'utf8', '-c',
      'from pathlib import Path; from PIL import Image; import sys; p=Path(sys.argv[1]); Image.new("RGB", (12, 8), "red").save(p/"产品2.png"); Image.new("RGB", (8, 12), "blue").save(p/"产品10.png"); (p/"损坏.png").write_bytes(b"broken"); (p/"说明.txt").write_text("keep", encoding="utf8")', directory]);
    const checked = await bridge(runtime, 'check', {});
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(checked.events[0].type, 'ready');
    const processed = await bridge(runtime, 'process', { folder: directory });
    assert.equal(processed.code, 0, processed.stderr);
    assert.equal(processed.events.filter(({ type }) => type === 'progress').length, 3);
    const result = processed.events.at(-1);
    assert.equal(result.type, 'result');
    assert.equal(result.folder, await realpath(directory));
    assert.equal(result.completed, 2);
    assert.equal(result.skipped[0][0], '损坏.png');
    assert.deepEqual((await readdir(directory)).sort(), ['1.jpg', '2.jpg', '损坏.png', '说明.txt'].sort());
    const verification = await execute(runtime.executable, [...runtime.prefix, '-X', 'utf8', '-c',
      'from pathlib import Path; from PIL import Image; import sys; p=Path(sys.argv[1]); assert all(Image.open(p/f"{n}.jpg").size == (800, 800) for n in (1,2)); assert Image.open(p/"1.jpg").getpixel((400,400))[0] > 240; assert Image.open(p/"2.jpg").getpixel((400,400))[2] > 240; print("verified")', directory]);
    assert.equal(verification.trim(), 'verified');
    assert.equal(await readFile(path.join(directory, '说明.txt'), 'utf8'), 'keep');
    const failed = await bridge(runtime, 'process', { folder: path.join(directory, 'missing') });
    assert.notEqual(failed.code, 0);
    assert.equal(failed.events.at(-1).type, 'error');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
