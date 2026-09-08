import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPreviewRequest,
  beginDraftSubmission,
  buildSharedImageAssignments,
  canGenerateCompletePreviews,
  createObsidianPublishingState,
  draftsForBatch,
  formatBatchLoadStatus,
  formatDraftVerification,
  formatPreviewSuccess,
  finishDraftSubmission,
  imageFileKey,
  imageContentKey,
  invalidatePreviewState,
  applySellingPointBinding,
  chooseBatchAfterRefresh,
  pendingVariants,
  preferredBatchPath,
  prepareReplacementVariant,
  remainingPlans,
  resolveUploadedImages,
  selectMainImagesByPlanNumber,
  sourceSellingPointCandidate,
  updateSourceProductIdentity,
  uniqueAssignmentImages,
} from '../public/obsidian-publishing.js';

function batch() {
  return { plans: Array.from({ length: 5 }, (_, index) => ({ id: `plan-${index + 1}` })) };
}

test('bulk main-image selection maps shuffled numeric filenames to the remaining plan ids', () => {
  const files = ['5.jpg', '2.png', '1.webp', '4.jpeg', '3.jpg'].map((name) => ({ name }));

  assert.deepEqual(
    selectMainImagesByPlanNumber(files, ['plan-1', 'plan-2', 'plan-4', 'plan-5']),
    [files[2], files[1], files[3], files[0]],
  );
});

test('bulk main-image selection rejects missing, duplicate, and unrecognized plan numbers', () => {
  assert.throws(
    () => selectMainImagesByPlanNumber(['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map((name) => ({ name })), ['plan-1', 'plan-2', 'plan-3', 'plan-4']),
    /必须一次选择命名为 1 到 5 的五张主图/,
  );
  assert.throws(
    () => selectMainImagesByPlanNumber(['1.jpg', '1.png', '2.jpg', '3.jpg', '4.jpg'].map((name) => ({ name })), ['plan-1', 'plan-2', 'plan-3', 'plan-4']),
    /主图编号 1 重复/,
  );
  assert.throws(
    () => selectMainImagesByPlanNumber(['1.jpg', '2.jpg', '3.jpg', '4.jpg', 'cover.jpg'].map((name) => ({ name })), ['plan-1', 'plan-2', 'plan-3', 'plan-4']),
    /无法识别主图文件名 cover.jpg/,
  );
});

test('createObsidianPublishingState starts without persisted product data', () => {
  assert.deepEqual(createObsidianPublishingState(), {
    batches: [],
    batch: null,
    basePlanId: '',
    sourceProductId: '',
    sourceContext: null,
    sellingPointBinding: null,
    sellingPointBindingConfirmed: false,
    allVariants: [],
    variants: [],
    completedDrafts: [],
    replacementDraftIds: {},
    mainImages: [null, null, null, null],
    marketingImages: [],
    fixedImages: [],
    filesByPlan: {},
    uploads: {},
    previews: [],
    sessionId: '',
    taskId: '',
    draftItems: {},
    draftSubmissionPlanId: '',
    savedDrafts: [],
    loading: false,
    error: '',
  });
});

test('draft submission state locks every plan until the active request finishes', () => {
  const state = createObsidianPublishingState();

  assert.equal(beginDraftSubmission(state, 'plan-2'), true);
  assert.equal(state.draftSubmissionPlanId, 'plan-2');
  assert.equal(beginDraftSubmission(state, 'plan-3'), false);
  finishDraftSubmission(state, 'plan-3');
  assert.equal(state.draftSubmissionPlanId, 'plan-2');
  finishDraftSubmission(state, 'plan-2');
  assert.equal(state.draftSubmissionPlanId, '');
});

test('preferredBatchPath automatically selects the newest valid Markdown batch', () => {
  assert.equal(preferredBatchPath([
    { relativePath: 'new-invalid.md', valid: false, modifiedAt: '2026-08-28T10:00:00.000Z' },
    { relativePath: 'older.md', valid: true, modifiedAt: '2026-08-27T10:00:00.000Z' },
    { relativePath: 'newer.md', valid: true, modifiedAt: '2026-08-28T09:00:00.000Z' },
  ]), 'newer.md');
  assert.equal(preferredBatchPath([{ relativePath: 'invalid.md', valid: false }]), '');
});

test('formatBatchLoadStatus presents batch warnings without rejecting the batch', () => {
  assert.deepEqual(
    formatBatchLoadStatus({ source: { warnings: ['机器数据块内容已过期，当前按正文读取'] } }),
    { message: '批次校验通过。机器数据块内容已过期，当前按正文读取', tone: 'warning' },
  );
});

test('imageContentKey hashes file bytes instead of reusable file metadata', async () => {
  const first = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  const second = { arrayBuffer: async () => new Uint8Array([1, 2, 4]).buffer };
  assert.notEqual(await imageContentKey(first), await imageContentKey(second));
});

test('buildSharedImageAssignments rotates shared images and uniqueAssignmentImages deduplicates them', () => {
  const state = createObsidianPublishingState();
  state.variants = ['plan-2', 'plan-3', 'plan-4', 'plan-5'].map((id) => ({ id }));
  const make = (character, fileName) => ({
    sha256: character.repeat(64), fileName: fileName || `${character}.jpg`,
    size: 10, mimeType: 'image/jpeg',
  });
  state.mainImages = ['0', '1', '2', '3'].map((value) => make(value, `main-${value}.jpg`));
  state.marketingImages = ['a', 'b', 'c'].map((value) => make(value));
  state.fixedImages = [make('e', '2.jpg'), make('f', '证书主图.jpg')];

  const assignments = buildSharedImageAssignments(state);

  assert.deepEqual(assignments[1].files.map((image) => image.fileName), [
    'main-1.jpg', '证书主图.jpg', 'b.jpg', 'c.jpg', 'a.jpg', '2.jpg',
  ]);
  assert.equal(uniqueAssignmentImages(assignments).length, 9);
});

test('sourceSellingPointCandidate requires one non-empty single-text candidate from the published product', () => {
  const candidate = {
    fieldId: 'textDesc', fieldName: '商品卖点', structureType: 'single-text',
    carrierPaths: [['value']], nonEmpty: true,
  };
  assert.deepEqual(sourceSellingPointCandidate([candidate]), {
    fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text',
  });
  assert.throws(() => sourceSellingPointCandidate([]), /无法从正式商品唯一确认卖点字段/);
  assert.throws(() => sourceSellingPointCandidate([{ ...candidate, nonEmpty: false }]), /无法从正式商品唯一确认卖点字段/);
});

test('complete preview generation requires both uploaded images and a confirmed selling point binding', () => {
  const state = createObsidianPublishingState();
  state.sellingPointBinding = {
    fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text',
  };

  assert.equal(canGenerateCompletePreviews(state, true), false);
  state.sellingPointBindingConfirmed = true;
  assert.equal(canGenerateCompletePreviews(state, false), false);
  assert.equal(canGenerateCompletePreviews(state, true), true);
});

test('remainingPlans excludes any selected base plan and preserves source order', () => {
  assert.deepEqual(remainingPlans(batch(), 'plan-3').map(({ id }) => id), [
    'plan-1', 'plan-2', 'plan-4', 'plan-5',
  ]);
});

test('remainingPlans rejects an unknown base plan', () => {
  assert.throws(() => remainingPlans(batch(), 'missing'), /请选择批次中的一个母商品方案/);
});

test('pendingVariants excludes completed plans without changing source order', () => {
  const variants = ['plan-2', 'plan-3', 'plan-4', 'plan-5'].map((id) => ({ id }));
  assert.deepEqual(pendingVariants(variants, ['plan-2']).map(({ id }) => id), [
    'plan-3', 'plan-4', 'plan-5',
  ]);
});

test('prepareReplacementVariant adds one completed plan back without duplicating pending plans', () => {
  const allVariants = ['plan-2', 'plan-3', 'plan-4', 'plan-5'].map((id) => ({ id }));
  const pending = [{ id: 'plan-5' }];
  assert.deepEqual(
    prepareReplacementVariant(allVariants, pending, 'plan-4').map(({ id }) => id),
    ['plan-4', 'plan-5'],
  );
  assert.throws(
    () => prepareReplacementVariant(allVariants, pending, 'missing'),
    /不属于当前批次/,
  );
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

test('applySellingPointBinding invalidates preview and draft authority when the binding changes', () => {
  const state = createObsidianPublishingState();
  state.sellingPointBinding = { fieldId: 'old', carrierPath: ['value'], structureType: 'single-text' };
  state.previews = [{ planId: 'plan-1' }];
  state.sessionId = 'session';
  state.taskId = 'task';
  state.draftItems = { 'plan-1': { status: 'preview_ready' } };

  applySellingPointBinding(state, {
    fieldId: 'new', carrierPath: ['value'], structureType: 'single-text',
  });

  assert.equal(state.sellingPointBinding.fieldId, 'new');
  assert.deepEqual(
    { previews: state.previews, sessionId: state.sessionId, taskId: state.taskId, draftItems: state.draftItems },
    { previews: [], sessionId: '', taskId: '', draftItems: {} },
  );
});

test('chooseBatchAfterRefresh preserves a loaded batch and clears it only when unavailable', () => {
  const batches = [
    { relativePath: 'older.md', valid: true, modifiedAt: '2026-08-27T10:00:00.000Z' },
    { relativePath: 'newer.md', valid: true, modifiedAt: '2026-08-28T10:00:00.000Z' },
  ];

  assert.deepEqual(chooseBatchAfterRefresh(batches, 'older.md'), {
    selectedPath: 'older.md', keepLoadedBatch: true,
  });
  assert.deepEqual(chooseBatchAfterRefresh(batches, 'missing.md'), {
    selectedPath: 'newer.md', keepLoadedBatch: false,
  });
});

test('draftsForBatch shows only drafts belonging to the loaded Markdown batch', () => {
  const drafts = [
    { taskId: 'shirt', relativePath: '2026-08-25/反光T恤4.md' },
    { taskId: 'pants', relativePath: '2026-08-28/反光裤子3.md' },
  ];

  assert.deepEqual(
    draftsForBatch(drafts, { source: { relativePath: '2026-08-28/反光裤子3.md' } }),
    [drafts[1]],
  );
  assert.deepEqual(draftsForBatch(drafts, null), []);
});

test('updateSourceProductIdentity invalidates a stale binding and preview when the published product changes', () => {
  const state = createObsidianPublishingState();
  state.sourceProductId = '1601936000000';
  state.sellingPointBinding = {
    fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text',
  };
  state.sellingPointBindingConfirmed = true;
  state.previews = [{ planId: 'plan-2' }];
  state.sessionId = 'session';
  state.taskId = 'task';
  state.draftItems = { 'plan-2': { status: 'preview_ready' } };

  assert.equal(updateSourceProductIdentity(state, '1601936999999'), true);
  assert.equal(state.sourceProductId, '1601936999999');
  assert.equal(state.sellingPointBinding, null);
  assert.equal(state.sellingPointBindingConfirmed, false);
  assert.deepEqual(
    { previews: state.previews, sessionId: state.sessionId, taskId: state.taskId, draftItems: state.draftItems },
    { previews: [], sessionId: '', taskId: '', draftItems: {} },
  );
});

test('formatPreviewSuccess reports the actual pending preview count', () => {
  assert.equal(
    formatPreviewSuccess(3),
    '3 份完整预览均通过：标题、卖点、FAQ、10 条属性和 6 张图片已替换，受保护字段保持不变。',
  );
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
  state.sellingPointBinding = {
    fieldId: 'sellingPoints', carrierPath: ['value'], structureType: 'single-text',
    categoryId: '301504', language: 'en_US', version: '1',
  };
  state.variants = [{ id: 'plan-2' }, { id: 'plan-3' }];
  const imagesByPlan = { 'plan-2': [{ fileId: 'file-2', url: 'https://img/2.jpg' }] };

  assert.deepEqual(buildPreviewRequest(state, imagesByPlan), {
    relativePath: '2026-08-25/反光T恤4.md',
    basePlanId: 'plan-1',
    sourceContext: state.sourceContext,
    planIds: ['plan-2', 'plan-3'],
    sellingPointBinding: state.sellingPointBinding,
    imagesByPlan,
  });
});

test('buildPreviewRequest binds a replacement preview to the exact prior draft id', () => {
  const state = createObsidianPublishingState();
  state.batch = { source: { relativePath: '2026-08-25/反光T恤4.md' } };
  state.basePlanId = 'plan-1';
  state.sourceContext = { sourceProductId: '1601933369105' };
  state.sellingPointBinding = { fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text' };
  state.variants = [{ id: 'plan-4' }];
  state.replacementDraftIds = { 'plan-4': '1601935213152' };

  assert.deepEqual(buildPreviewRequest(state, { 'plan-4': [] }), {
    relativePath: '2026-08-25/反光T恤4.md',
    basePlanId: 'plan-1',
    sourceContext: state.sourceContext,
    planIds: ['plan-4'],
    sellingPointBinding: state.sellingPointBinding,
    imagesByPlan: { 'plan-4': [] },
    replacementDraftIds: { 'plan-4': '1601935213152' },
    replacementConfirmed: true,
  });
});
