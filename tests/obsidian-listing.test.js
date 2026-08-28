import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  extractListingPayload,
  listObsidianBatches,
  readObsidianBatch,
  validateListingBatch,
} from '../src/obsidian-listing.js';

function validPayload() {
  return {
    schemaVersion: 1,
    batchId: 'reflective-vest-001',
    batchName: 'Reflective Vest',
    plans: Array.from({ length: 5 }, (_, planIndex) => ({
      id: `plan-${planIndex + 1}`,
      title: `Reflective Safety Vest Plan ${planIndex + 1}`,
      sellingPoints: `Selling points for plan ${planIndex + 1}`,
      faqs: Array.from({ length: 5 }, (_, faqIndex) => ({
        question: `Question ${faqIndex + 1}?`,
        answer: `Answer ${faqIndex + 1}.`,
      })),
      customAttributes: Array.from({ length: 10 }, (_, attributeIndex) => ({
        name: `Attribute ${attributeIndex + 1}`,
        value: `Value ${attributeIndex + 1}`,
      })),
    })),
  };
}

function markdownFor(payload) {
  const readablePlans = payload.plans.flatMap((plan, planIndex) => [
    `## 方案 ${planIndex + 1}：测试方案`,
    '',
    '<!-- selling-points:start -->',
    '#### 卖点策略说明',
    '',
    '测试说明。',
    '',
    '#### Selling Points',
    '',
    ...Array.from({ length: 5 }, (_, pointIndex) => (
      `• Plan ${planIndex + 1} Point ${pointIndex + 1}: Verified selling point ${pointIndex + 1}.`
    )),
    '<!-- selling-points:end -->',
    '',
  ]);
  return [
    '# Human-readable listing',
    '',
    ...readablePlans,
    '<!-- alibaba-listing-batch:start -->',
    '```json',
    JSON.stringify(payload),
    '```',
    '<!-- alibaba-listing-batch:end -->',
  ].join('\n');
}

test('extractListingPayload reads a versioned five-plan machine block', () => {
  assert.deepEqual(extractListingPayload(markdownFor(validPayload())), validPayload());
});

test('extractListingPayload rejects duplicate machine blocks', () => {
  const markdown = `${markdownFor(validPayload())}\n${markdownFor(validPayload())}`;
  assert.throws(() => extractListingPayload(markdown), /只能包含一个阿里发品机器数据块/);
});

test('validateListingBatch accepts exactly five complete plans', () => {
  const result = validateListingBatch(validPayload(), { relativePath: 'vests/batch.md' });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.plans.length, 5);
  assert.equal(result.source.relativePath, 'vests/batch.md');
});

test('validateListingBatch rejects unsupported schema versions', () => {
  const payload = validPayload();
  payload.schemaVersion = 2;
  assert.throws(() => validateListingBatch(payload), /不支持 schemaVersion 2/);
});

test('validateListingBatch requires five plans', () => {
  const payload = validPayload();
  payload.plans.pop();
  assert.throws(() => validateListingBatch(payload), /plans 必须正好包含 5 套方案/);
});

test('validateListingBatch requires five FAQs in every plan', () => {
  const payload = validPayload();
  payload.plans[2].faqs.pop();
  assert.throws(() => validateListingBatch(payload), /plans\[2\]\.faqs 必须正好包含 5 条/);
});

test('validateListingBatch requires ten unique custom attributes in every plan', () => {
  const payload = validPayload();
  payload.plans[1].customAttributes[9].name = 'Attribute 1';
  assert.throws(() => validateListingBatch(payload), /plans\[1\]\.customAttributes 属性名不能重复/);
});

test('validateListingBatch rejects duplicate plan ids and blank values', () => {
  const duplicate = validPayload();
  duplicate.plans[4].id = 'plan-1';
  assert.throws(() => validateListingBatch(duplicate), /方案 id 不能重复/);

  const blank = validPayload();
  blank.plans[0].faqs[0].answer = '   ';
  assert.throws(() => validateListingBatch(blank), /plans\[0\]\.faqs\[0\]\.answer 不能为空/);
});

test('listObsidianBatches finds nested Markdown and reports invalid files safely', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-listings-'));
  await mkdir(path.join(root, 'vests'));
  await writeFile(path.join(root, 'vests', 'valid.md'), markdownFor(validPayload()), 'utf8');
  await writeFile(path.join(root, 'broken.md'), '# no machine block', 'utf8');
  await writeFile(path.join(root, 'ignore.txt'), markdownFor(validPayload()), 'utf8');

  const batches = await listObsidianBatches(root);

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map(({ relativePath }) => relativePath), ['broken.md', 'vests/valid.md']);
  assert.equal(batches[0].valid, false);
  assert.match(batches[0].error, /缺少阿里发品机器数据块/);
  assert.deepEqual(
    { valid: batches[1].valid, batchId: batches[1].batchId, batchName: batches[1].batchName },
    { valid: true, batchId: 'reflective-vest-001', batchName: 'Reflective Vest' },
  );
});

test('readObsidianBatch strips Obsidian bullets before returning Alibaba selling points', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-read-'));
  await writeFile(path.join(root, 'batch.md'), markdownFor(validPayload()), 'utf8');

  const batch = await readObsidianBatch(root, 'batch.md');

  assert.equal(batch.batchId, 'reflective-vest-001');
  assert.equal(batch.plans[2].sellingPoints, [
    'Plan 3 Point 1: Verified selling point 1.',
    'Plan 3 Point 2: Verified selling point 2.',
    'Plan 3 Point 3: Verified selling point 3.',
    'Plan 3 Point 4: Verified selling point 4.',
    'Plan 3 Point 5: Verified selling point 5.',
  ].join('\n'));
  assert.doesNotMatch(batch.plans[2].sellingPoints, /^•/m);
  assert.equal(batch.source.relativePath, 'batch.md');
  assert.equal(typeof batch.source.modifiedAt, 'string');
});

test('readObsidianBatch rejects a managed selling-point block without exactly five bullets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-selling-points-'));
  const markdown = markdownFor(validPayload()).replace(
    '• Plan 3 Point 5: Verified selling point 5.\n',
    '',
  );
  await writeFile(path.join(root, 'batch.md'), markdown, 'utf8');

  await assert.rejects(
    () => readObsidianBatch(root, 'batch.md'),
    /plan-3 的正文卖点必须正好包含 5 条/,
  );
});

test('readObsidianBatch blocks traversal, absolute paths, and non-Markdown files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-safe-'));
  await writeFile(path.join(root, 'batch.txt'), markdownFor(validPayload()), 'utf8');

  await assert.rejects(() => readObsidianBatch(root, '../outside.md'), /必须位于 Obsidian 发品目录内/);
  await assert.rejects(() => readObsidianBatch(root, path.resolve(root, 'batch.txt')), /必须使用相对路径/);
  await assert.rejects(() => readObsidianBatch(root, 'batch.txt'), /只允许读取 Markdown 文件/);
});

test('listObsidianBatches returns an empty list when the fixed root does not exist', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'obsidian-missing-'));
  assert.deepEqual(await listObsidianBatches(path.join(parent, 'not-created')), []);
});
