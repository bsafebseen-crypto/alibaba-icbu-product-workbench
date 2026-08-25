import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createObsidianPublishingTask,
  readObsidianPublishingTask,
  updateObsidianDraftItem,
} from '../src/obsidian-task-store.js';

test('Obsidian task store persists only safe draft status metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-task-'));
  const created = await createObsidianPublishingTask(root, {
    batchId: 'batch-1',
    relativePath: 'vests/batch.md',
    basePlanId: 'plan-1',
    sourceProductId: '1601915922577',
    context: { categoryId: '32905', language: 'en_US', publishType: 'default', version: 'trade.1.1' },
    items: [{ planId: 'plan-2', fingerprint: 'hash-2', status: 'preview_ready', previewXml: '<secret />' }],
    schemaXml: '<source />',
    accessToken: 'token',
  }, 'task-1');

  assert.equal(created.id, 'task-1');
  const storedText = await readFile(path.join(root, 'data', 'tasks', 'obsidian-task-1.json'), 'utf8');
  assert.equal(storedText.includes('<secret'), false);
  assert.equal(storedText.includes('<source'), false);
  assert.equal(storedText.includes('token'), false);
  assert.deepEqual((await readObsidianPublishingTask(root, 'task-1')).items, [
    { planId: 'plan-2', fingerprint: 'hash-2', status: 'preview_ready' },
  ]);
});

test('updateObsidianDraftItem atomically advances one item and task version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-task-update-'));
  const created = await createObsidianPublishingTask(root, {
    items: [{ planId: 'plan-2', fingerprint: 'hash-2', status: 'preview_ready' }],
  }, 'task-2');
  const updated = await updateObsidianDraftItem(root, 'task-2', 'plan-2', {
    planId: 'plan-2', fingerprint: 'hash-2', status: 'submitting', attemptStartedAt: 'now',
  }, created.version);
  assert.equal(updated.version, created.version + 1);
  assert.equal(updated.items[0].status, 'submitting');
  await assert.rejects(
    () => updateObsidianDraftItem(root, 'task-2', 'plan-2', updated.items[0], created.version),
    /任务状态已经变化/,
  );
});

test('Obsidian task store rejects unsafe task ids and unknown plans', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-task-safe-'));
  await assert.rejects(() => readObsidianPublishingTask(root, '../task'), /任务编号无效/);
  await createObsidianPublishingTask(root, { items: [] }, 'task-3');
  await assert.rejects(
    () => updateObsidianDraftItem(root, 'task-3', 'missing', {}, 1),
    /任务中不存在方案 missing/,
  );
});
