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
      sellingPoints: Array.from({ length: 5 }, (_, pointIndex) => (
        `Plan ${planIndex + 1} Point ${pointIndex + 1}: Verified selling point ${pointIndex + 1}.`
      )).join('\n'),
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
    `- **Title:** ${plan.title}`,
    '',
    '### 10 Custom Attributes',
    '',
    ...plan.customAttributes.map(({ name, value }, index) => `${index + 1}. ${name}: ${value}`),
    '',
    '### 5 FAQs',
    '',
    ...plan.faqs.flatMap(({ question, answer }, index) => [
      `${index + 1}. **Q:** ${question}`,
      `   **A:** ${answer}`,
      `   **埋入关键词:** keyword ${index + 1}`,
    ]),
    '',
    '<!-- selling-points:start -->',
    '#### Selling Points',
    '',
    ...plan.sellingPoints.split('\n').map((point) => `• ${point}`),
    '<!-- selling-points:end -->',
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

function bodyMarkdown({ bullet = '•', missing = '' } = {}) {
  const plans = Array.from({ length: 5 }, (_, planIndex) => {
    const number = planIndex + 1;
    const attributes = Array.from({ length: 10 }, (_, index) => (
      `${index + 1}. Attribute ${index + 1}: Plan ${number} Value ${index + 1}`
    ));
    const faqs = Array.from({ length: 5 }, (_, index) => [
      `${index + 1}. **Q:** Plan ${number} Question ${index + 1}?`,
      `   **A:** Plan ${number} Answer ${index + 1}.`,
      `   **埋入关键词:** keyword ${index + 1}`,
    ].join('\n'));
    const points = Array.from({ length: 5 }, (_, index) => (
      `${bullet} Plan ${number} Point ${index + 1}: Body selling point ${index + 1}.`
    ));
    return [
      `## 方案 ${number}：正文方案`, '',
      missing === `title-${number}` ? '' : `- **Title:** Reflective Product Body Plan ${number}`, '',
      '### 10 Custom Attributes', '', ...attributes, '',
      '### 5 FAQs', '', ...faqs, '',
      '#### Selling Points', '', ...points,
    ].join('\n');
  });
  return ['# Reflective Product 国际站发品方案', '', ...plans].join('\n');
}

test('extractListingPayload reads a versioned five-plan machine block', () => {
  assert.deepEqual(extractListingPayload(markdownFor(validPayload())), validPayload());
});

test('readObsidianBatch parses five complete plans without a machine block', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-'));
  await writeFile(path.join(root, 'body.md'), bodyMarkdown(), 'utf8');
  const batch = await readObsidianBatch(root, 'body.md');
  assert.equal(batch.batchName, 'Reflective Product');
  assert.equal(batch.plans.length, 5);
  assert.equal(batch.plans[3].title, 'Reflective Product Body Plan 4');
  assert.equal(batch.plans[3].customAttributes.length, 10);
  assert.equal(batch.plans[3].faqs.length, 5);
  assert.equal(batch.plans[3].sellingPoints.split('\n').length, 5);
});

test('body content wins when a legacy machine block is stale', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-legacy-drift-'));
  const legacy = validPayload();
  legacy.plans[0].title = 'Stale machine title';
  const machine = `<!-- alibaba-listing-batch:start -->\n\`\`\`json\n${JSON.stringify(legacy)}\n\`\`\`\n<!-- alibaba-listing-batch:end -->`;
  await writeFile(path.join(root, 'body.md'), `${bodyMarkdown()}\n${machine}`, 'utf8');

  const batch = await readObsidianBatch(root, 'body.md');

  assert.equal(batch.batchId, legacy.batchId);
  assert.equal(batch.plans[0].title, 'Reflective Product Body Plan 1');
  assert.deepEqual(batch.source.warnings, ['机器数据块内容已过期，当前按正文读取']);
});

test('readObsidianBatch loads valid body content when legacy machine JSON is malformed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-legacy-malformed-'));
  const machine = '<!-- alibaba-listing-batch:start -->\n```json\n{invalid\n```\n<!-- alibaba-listing-batch:end -->';
  await writeFile(path.join(root, 'body.md'), `${bodyMarkdown()}\n${machine}`, 'utf8');

  const batch = await readObsidianBatch(root, 'body.md');

  assert.equal(batch.plans[0].title, 'Reflective Product Body Plan 1');
  assert.match(batch.source.warnings[0], /机器数据块无效/);
});

test('readObsidianBatch strips all supported Obsidian selling-point bullets', async () => {
  for (const bullet of ['•', '-', '*']) {
    const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-bullets-'));
    await writeFile(path.join(root, 'body.md'), bodyMarkdown({ bullet }), 'utf8');
    const batch = await readObsidianBatch(root, 'body.md');
    assert.doesNotMatch(batch.plans[0].sellingPoints, /^[•*-]/m);
  }
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
  assert.match(batches[0].error, /方案编号必须恰好为 1、2、3、4、5/);
  assert.deepEqual(
    { valid: batches[1].valid, batchName: batches[1].batchName, warnings: batches[1].warnings },
    { valid: true, batchName: 'Human-readable listing', warnings: [] },
  );
  assert.equal(batches[1].batchId, 'reflective-vest-001');
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

test('body parser reports the exact plan with a missing title', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-error-'));
  await writeFile(path.join(root, 'body.md'), bodyMarkdown({ missing: 'title-3' }), 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案 3 缺少 Title/);
});

test('body parser reports invalid plan numbering', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-number-error-'));
  await writeFile(path.join(root, 'body.md'), bodyMarkdown().replace('## 方案 5：正文方案', '## 方案 4：正文方案'), 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案编号必须恰好为 1、2、3、4、5/);
});

test('body parser rejects an out-of-range plan heading', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-extra-plan-'));
  await writeFile(path.join(root, 'body.md'), `${bodyMarkdown()}\n## 方案 6：额外方案`, 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案编号必须恰好为 1、2、3、4、5/);
});

test('body parser rejects zero-padded plan headings', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-zero-padded-plan-'));
  const markdown = bodyMarkdown().replace(/## 方案 ([1-5])：/g, '## 方案 0$1：');
  await writeFile(path.join(root, 'body.md'), markdown, 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案编号必须恰好为 1、2、3、4、5/);
});

test('body parser reports an attribute count with the exact plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-attribute-error-'));
  const markdown = bodyMarkdown().replace('10. Attribute 10: Plan 2 Value 10\n\n### 5 FAQs', '### 5 FAQs');
  await writeFile(path.join(root, 'body.md'), markdown, 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案 2.*10.*实际.*9/);
});

test('body parser reports a missing FAQ answer with the exact plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-faq-error-'));
  const markdown = bodyMarkdown().replace('   **A:** Plan 5 Answer 5.\n', '');
  await writeFile(path.join(root, 'body.md'), markdown, 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案 5.*FAQ 5.*Answer/);
});

test('body parser reports a selling-point count with the exact plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-selling-error-'));
  const markdown = bodyMarkdown().replace('• Plan 1 Point 5: Body selling point 5.\n', '');
  await writeFile(path.join(root, 'body.md'), markdown, 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案 1.*5.*实际.*4/);
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
    /方案 3 的 Selling Points 必须正好包含 5 条，实际包含 4 条/,
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
