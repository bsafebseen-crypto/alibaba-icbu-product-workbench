import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  create1688Task,
  list1688Tasks,
  read1688Task,
  update1688Task,
} from '../src/1688-task-store.js';

test('1688 task store uses an isolated prefix and persists safe product state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'task-1688-'));
  const created = await create1688Task(root, {
    categoryId: '1031910',
    scene: 'popular',
    schemaHash: 'schema-hash',
    product: {
      title: '反光背心',
      skuTable: [{ sku_cargoNumber: 'WB-001', sku_price: 12.5 }],
      primaryPicture: { imageList: [{ id: 'photo-1', url: 'https://img.example/1.jpg' }] },
    },
    publication: { status: 'ready', fingerprint: 'fingerprint-1', writeConsumed: false },
    accessToken: 'top-secret-token',
    refreshToken: 'refresh-secret',
    appSecret: 'app-secret',
    imageBytes: Buffer.from('image'),
  }, 'task-1');

  assert.equal(created.kind, '1688-publishing');
  const file = path.join(root, 'data', 'tasks', '1688-task-1.json');
  const text = await readFile(file, 'utf8');
  assert.equal(text.includes('top-secret-token'), false);
  assert.equal(text.includes('refresh-secret'), false);
  assert.equal(text.includes('app-secret'), false);
  assert.equal(text.includes('imageBytes'), false);
  assert.equal(text.includes('反光背心'), true);
  assert.deepEqual((await read1688Task(root, 'task-1')).product.skuTable, [
    { sku_cargoNumber: 'WB-001', sku_price: 12.5 },
  ]);
});
test('update1688Task advances the version atomically and rejects stale writers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'task-1688-version-'));
  const created = await create1688Task(root, {
    publication: { status: 'ready', fingerprint: 'fp', writeConsumed: false },
  }, 'task-2');
  const updated = await update1688Task(root, 'task-2', {
    ...created,
    publication: { status: 'publishing', fingerprint: 'fp', writeConsumed: true },
  }, created.version);

  assert.equal(updated.version, 2);
  assert.equal(updated.publication.status, 'publishing');
  await assert.rejects(
    () => update1688Task(root, 'task-2', updated, created.version),
    (error) => error.status === 409 && /任务状态已经变化/.test(error.message),
  );
});

test('1688 task store rejects unsafe ids and lists only 1688 tasks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'task-1688-list-'));
  await assert.rejects(() => read1688Task(root, '../escape'), /任务编号无效/);
  await create1688Task(root, { product: { title: '旧任务' } }, 'older');
  await create1688Task(root, { product: { title: '新任务' } }, 'newer');

  const tasks = await list1688Tasks(root);
  assert.deepEqual(tasks.map(({ id }) => id).sort(), ['newer', 'older']);
  assert.equal(tasks.every(({ kind }) => kind === '1688-publishing'), true);
});

test('update1688Task strips credentials introduced by later updates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'task-1688-redact-'));
  const created = await create1688Task(root, { product: { title: '商品' } }, 'task-3');
  await update1688Task(root, 'task-3', {
    ...created,
    product: {
      ...created.product,
      nested: { authorization: 'Bearer leak', access_token: 'leak', safe: 'keep' },
    },
  }, created.version);

  const stored = await read1688Task(root, 'task-3');
  assert.deepEqual(stored.product.nested, { safe: 'keep' });
});
