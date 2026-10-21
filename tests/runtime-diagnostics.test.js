import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('runtime diagnostics record startup, fatal location and exit without error contents or credentials', async () => {
  const { installRuntimeDiagnostics } = await import('../src/runtime-diagnostics.js');
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-runtime-'));
  const runtime = new EventEmitter();
  runtime.pid = 123;
  const diagnostics = installRuntimeDiagnostics(rootDir, runtime);
  diagnostics.record('listening', { port: 54025, accessToken: 'fake-private-token' });
  const error = new TypeError('request contained /src/fake-private-token:12:34\n    at user input (/src/fake-private-token:56:78)');
  error.code = 'ERR_INVALID_URL';
  error.stack = `TypeError: ${error.message}\n    at new URL (node:internal/url:819:25)\n    at Server.<anonymous> (file:///example/src/server.js:415:17)`;
  runtime.emit('uncaughtExceptionMonitor', error, 'unhandledRejection');
  runtime.emit('exit', 1);
  const directory = path.join(rootDir, 'data/runtime');
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const text = await readFile(path.join(directory, files[0]), 'utf8');
  assert.equal(text.includes('fake-private-token'), false);
  const records = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => record.event), ['start', 'listening', 'fatal', 'exit']);
  assert.equal(records[1].port, 54025);
  assert.equal(records[2].errorCode, 'ERR_INVALID_URL');
  assert.equal(records[2].errorType, 'TypeError');
  assert.deepEqual(records[2].locations, ['src/server.js:415:17']);
  assert.equal(records[3].exitCode, 1);
  assert.equal(runtime.listenerCount('uncaughtException'), 0, 'logging must not swallow fatal exceptions');
});

test('an unavailable diagnostic directory cannot itself crash the workbench', async () => {
  const { installRuntimeDiagnostics } = await import('../src/runtime-diagnostics.js');
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-runtime-unavailable-'));
  await writeFile(path.join(rootDir, 'data'), 'not a directory');
  const runtime = new EventEmitter();
  runtime.pid = 123;
  assert.doesNotThrow(() => {
    const diagnostics = installRuntimeDiagnostics(rootDir, runtime);
    diagnostics.record('listening', { port: 54025 });
    runtime.emit('exit', 0);
  });
});
