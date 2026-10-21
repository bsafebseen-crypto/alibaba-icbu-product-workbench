import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('a malformed request target returns 400 without terminating the server process', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-lifecycle-'));
  const serverModule = new URL('../src/server.js', import.meta.url).href;
  const script = `
    import http from 'node:http';
    import { createServer } from ${JSON.stringify(serverModule)};
    const server = createServer({ rootDir: ${JSON.stringify(rootDir)} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const badStatus = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path: '//', method: 'GET' }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    const health = await fetch('http://127.0.0.1:' + port + '/api/health');
    const healthy = health.status === 200 && (await health.json()).ok === true;
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ badStatus, healthy }));
  `;
  const result = await new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], { timeout: 8000 }, (error, stdout, stderr) => {
      resolve({ exitCode: error?.code ?? 0, stdout, stderr });
    });
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { badStatus: 400, healthy: true });
});
