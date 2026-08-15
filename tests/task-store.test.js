import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listTasks, readTask, saveTask } from '../src/task-store.js';

test('saveTask writes a sanitized prepared task inside data/tasks', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-workbench-'));
  const result = await saveTask(rootDir, {
    apiKey: 'never-store-me',
    generation: { apiKey: 'also-secret', provider: 'custom' },
    source: {
      imageNames: ['front.jpg'],
      words: ['safety vest'],
      imageDataUrls: [{ dataUrl: 'data:image/jpeg;base64,AAA' }],
    },
    products: Array.from({ length: 5 }, (_, index) => ({ index: index + 1 })),
  });

  assert.equal(path.dirname(result.path), path.join(rootDir, 'data', 'tasks'));
  assert.match(result.id, /^\d{8}-[0-9a-f-]{36}$/);

  const raw = await readFile(result.path, 'utf8');
  assert.equal(raw.includes('never-store-me'), false);
  assert.equal(raw.includes('also-secret'), false);
  assert.equal(raw.includes('data:image'), false);
  assert.equal(result.task.status, 'prepared');
  assert.equal(result.task.products.length, 5);
});

test('listTasks returns safe newest-first summaries and isolates malformed files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-pool-'));
  const taskDir = path.join(rootDir, 'data', 'tasks');
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, '20260810-old.json'), JSON.stringify({
    id: '20260810-old',
    createdAt: '2026-08-10T01:00:00.000Z',
    status: 'prepared',
    source: {
      sourceProductId: '100',
      photobankUploads: {
        'main:0': { fileId: 'm0', photobankUrl: 'https://img/m0.jpg' },
        'auxiliary:0': { fileId: 'a0', photobankUrl: 'https://img/a0.jpg' },
        'auxiliary:1': { fileId: 'a1', photobankUrl: 'https://img/a1.jpg' },
        'auxiliary:2': { fileId: 'a2', photobankUrl: 'https://img/a2.jpg' },
        'auxiliary:3': { fileId: 'a3', photobankUrl: 'https://img/a3.jpg' },
        'auxiliary:4': { fileId: 'a4', photobankUrl: 'https://img/a4.jpg' },
      },
    },
    generation: { mode: 'template', apiKey: 'must-not-leak' },
    products: [{
      index: 1,
      title: 'Old',
      faqItems: Array(5).fill({ question: 'Q?', answer: 'A.' }),
      customAttributes: [{ name: 'Material', value: 'Polyester' }],
      imageAssignment: { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
      preview: { previewXml: '<itemSchema />', changedFields: ['title', 'images'] },
    }],
  }));
  await writeFile(path.join(taskDir, '20260811-new.json'), JSON.stringify({
    id: '20260811-new',
    createdAt: '2026-08-11T01:00:00.000Z',
    status: 'prepared',
    source: { sourceProductId: '200' },
    generation: { mode: 'template' },
    products: [{ index: 1, title: 'New' }],
  }));
  await writeFile(path.join(taskDir, 'broken.json'), '{broken');

  const result = await listTasks(rootDir);

  assert.deepEqual(result.tasks.map((task) => task.id), ['20260811-new', '20260810-old']);
  assert.equal(result.tasks[1].imageUploadCount, 6);
  assert.equal(result.tasks[1].previewCount, 1);
  assert.equal(result.tasks[1].products[0].imageReady, true);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(result.invalid, [{ fileName: 'broken.json', error: '任务文件损坏' }]);
  assert.equal((await readTask(rootDir, '20260811-new')).products[0].title, 'New');
});

test('readTask rejects unsafe task ids and missing tasks', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-pool-'));
  await assert.rejects(() => readTask(rootDir, '../secret'), /任务编号无效/);
  await assert.rejects(() => readTask(rootDir, 'missing-task'), /任务不存在/);
});
