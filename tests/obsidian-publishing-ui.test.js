import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPreviewRequest,
  createObsidianPublishingState,
  formatDraftVerification,
  imageFileKey,
  invalidatePreviewState,
  remainingPlans,
  resolveUploadedImages,
} from '../public/obsidian-publishing.js';

function batch() {
  return { plans: Array.from({ length: 5 }, (_, index) => ({ id: `plan-${index + 1}` })) };
}

test('createObsidianPublishingState starts without persisted product data', () => {
  assert.deepEqual(createObsidianPublishingState(), {
    batches: [],
    batch: null,
    basePlanId: '',
    sourceProductId: '',
    sourceContext: null,
    variants: [],
    filesByPlan: {},
    uploads: {},
    previews: [],
    sessionId: '',
    taskId: '',
    draftItems: {},
    savedDrafts: [],
    loading: false,
    error: '',
  });
});

test('remainingPlans excludes any selected base plan and preserves source order', () => {
  assert.deepEqual(remainingPlans(batch(), 'plan-3').map(({ id }) => id), [
    'plan-1', 'plan-2', 'plan-4', 'plan-5',
  ]);
});

test('remainingPlans rejects an unknown base plan', () => {
  assert.throws(() => remainingPlans(batch(), 'missing'), /请选择批次中的一个母商品方案/);
});

test('resolveUploadedImages maps one main and five auxiliary images in selection order', () => {
  const variants = [{ id: 'plan-1' }];
  const files = Array.from({ length: 6 }, (_, index) => ({
    name: `image-${index}.jpg`, size: 100 + index, lastModified: 1000 + index,
  }));
  const uploads = Object.fromEntries(files.map((file, index) => [
    imageFileKey(file),
    { fileId: `file-${index}`, photobankUrl: `https://img/${index}.jpg` },
  ]));

  assert.deepEqual(resolveUploadedImages(variants, { 'plan-1': files }, uploads), {
    'plan-1': Array.from({ length: 6 }, (_, index) => ({
      fileId: `file-${index}`,
      url: `https://img/${index}.jpg`,
    })),
  });
});

test('resolveUploadedImages blocks incomplete selections and pending uploads', () => {
  const variants = [{ id: 'plan-1' }];
  const files = Array.from({ length: 5 }, (_, index) => ({ name: `${index}.jpg`, size: index, lastModified: index }));
  assert.throws(() => resolveUploadedImages(variants, { 'plan-1': files }, {}), /plan-1 必须选择 6 张图片/);

  files.push({ name: '5.jpg', size: 5, lastModified: 5 });
  const firstFiveUploads = Object.fromEntries(files.slice(0, 5).map((file) => [
    imageFileKey(file), { fileId: file.name, photobankUrl: `https://img/${file.name}` },
  ]));
  assert.throws(
    () => resolveUploadedImages(variants, { 'plan-1': files }, firstFiveUploads),
    /5\.jpg 尚未上传到图片银行/,
  );
});

test('invalidatePreviewState clears draft authority after an image changes', () => {
  const state = createObsidianPublishingState();
  state.previews = [{ planId: 'plan-1' }];
  state.sessionId = 'session';
  state.taskId = 'task';
  state.draftItems = { 'plan-1': { status: 'preview_ready' } };

  invalidatePreviewState(state);

  assert.deepEqual(
    { previews: state.previews, sessionId: state.sessionId, taskId: state.taskId, draftItems: state.draftItems },
    { previews: [], sessionId: '', taskId: '', draftItems: {} },
  );
});

test('formatDraftVerification summarizes successful and mismatched read-only checks', () => {
  assert.equal(formatDraftVerification({
    traceId: 'trace-1',
    comparison: { exactMatch: true, differences: [] },
  }), '核对一致：标题、卖点、5 条 FAQ、10 条属性和 6 张图片信息均完整。追踪号 trace-1');

  assert.equal(formatDraftVerification({
    traceId: 'trace-order',
    comparison: {
      exactMatch: true,
      fields: { customAttributes: { match: true, orderChanged: true } },
      differences: [],
    },
  }), '核对一致：标题、卖点、5 条 FAQ、10 条属性和 6 张图片信息均完整。阿里调整了属性顺序，名称和值一致。追踪号 trace-order');

  assert.equal(formatDraftVerification({
    traceId: 'trace-2',
    comparison: { exactMatch: false, differences: ['title', 'faqs', 'images'] },
  }), '发现差异：标题、FAQ、图片。追踪号 trace-2');

  assert.equal(formatDraftVerification({
    traceId: 'trace-3',
    comparison: {
      exactMatch: false,
      differences: ['customAttributes'],
      fields: {
        customAttributes: {
          details: {
            orderMatch: false,
            missing: [{ name: 'Attribute 4', value: 'Value 4' }],
            unexpected: [{ name: 'Extra', value: 'Extra value' }],
            changed: [{ name: 'Attribute 3', expectedValue: 'Value 3', actualValue: 'Changed value' }],
          },
        },
      },
    },
  }), '发现差异：属性。属性明细：顺序不同；Attribute 3：期望“Value 3”，草稿“Changed value”；缺少 Attribute 4=Value 4；多出 Extra=Extra value。追踪号 trace-3');
});

test('buildPreviewRequest preserves source product publishing context', () => {
  const state = createObsidianPublishingState();
  state.batch = { source: { relativePath: '2026-08-25/反光T恤4.md' } };
  state.basePlanId = 'plan-1';
  state.sourceContext = {
    sourceProductId: '1601933369105',
    categoryId: '301504',
    language: 'en_US',
    publishType: 'default',
    version: '1',
    sourceProductType: 'sourcing',
    schemaXml: '<schema />',
  };
  const imagesByPlan = { 'plan-2': [{ fileId: 'file-2', url: 'https://img/2.jpg' }] };

  assert.deepEqual(buildPreviewRequest(state, imagesByPlan), {
    relativePath: '2026-08-25/反光T恤4.md',
    basePlanId: 'plan-1',
    sourceContext: state.sourceContext,
    imagesByPlan,
  });
});
