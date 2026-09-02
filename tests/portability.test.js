import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows launcher installs locked dependencies on a clean clone', async () => {
  const launcher = await readFile(path.join(rootDir, '启动工作台.cmd'), 'utf8');
  assert.match(launcher, /node_modules/);
  assert.match(launcher, /npm ci/);
  assert.match(launcher, /Node\.js 20/);
});

test('gitignore excludes machine-local dependencies, credentials, tasks, and temporary files', async () => {
  const ignore = await readFile(path.join(rootDir, '.gitignore'), 'utf8');
  for (const entry of ['node_modules/', 'data/tasks/', 'data/inquiry-review/', '.env', '*.log', 'tmp/']) {
    assert.match(ignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('vault tests use temporary directories instead of a repository fixture', async () => {
  await assert.rejects(
    () => access(path.join(rootDir, 'tests', 'fixtures', 'inquiry-vault')),
    { code: 'ENOENT' },
  );
});

test('portable project files do not contain a developer-specific absolute path', async () => {
  const files = ['package.json', 'README.md', '启动工作台.cmd'];
  const contents = await Promise.all(files.map((file) => readFile(path.join(rootDir, file), 'utf8')));
  assert.equal(contents.some((content) => /C:\\Users\\Fuyuhao/i.test(content)), false);
});
