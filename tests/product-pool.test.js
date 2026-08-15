import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProductRows,
  filterProductRows,
  sortProductRows,
  summarizeDashboard,
} from '../public/product-pool.js';

test('buildProductRows expands task products and derives actionable stages', () => {
  const rows = buildProductRows([{
    id: 'task-1',
    createdAt: '2026-08-11T01:00:00.000Z',
    updatedAt: '2026-08-11T02:00:00.000Z',
    sourceProductId: '1601915922577',
    mode: 'template',
    products: [
      {
        index: 1,
        title: 'Ready Vest',
        faqCount: 5,
        customAttributeCount: 5,
        imageReady: true,
        hasPreview: true,
        previewFields: ['title', 'images'],
      },
      {
        index: 2,
        title: '',
        faqCount: 3,
        customAttributeCount: 0,
        imageReady: false,
        hasPreview: false,
        previewFields: [],
      },
    ],
  }]);

  assert.equal(rows[0].stage, 'preview-ready');
  assert.deepEqual(rows[0].issues, []);
  assert.equal(rows[0].sourceProductId, '1601915922577');
  assert.equal(rows[1].stage, 'needs-content');
  assert.deepEqual(rows[1].issues, [
    '缺少标题',
    'FAQ 不足 5 组',
    '缺少自定义属性',
    '图片银行未完成',
    '尚未生成完整预览',
  ]);
});

test('buildProductRows prioritizes image and preview stages after content is complete', () => {
  const rows = buildProductRows([{
    id: 'task-2',
    products: [
      { index: 1, title: 'A', faqCount: 5, customAttributeCount: 1, imageReady: false },
      { index: 2, title: 'B', faqCount: 5, customAttributeCount: 1, imageReady: true },
    ],
  }]);

  assert.equal(rows[0].stage, 'needs-images');
  assert.equal(rows[1].stage, 'needs-preview');
});

test('filter, sort, and dashboard summary operate on derived rows', () => {
  const rows = [
    {
      taskId: 'b', title: 'Traffic Vest', sourceProductId: '200',
      stage: 'needs-content', updatedAt: '2026-08-10T00:00:00Z',
    },
    {
      taskId: 'a', title: 'Warehouse Vest', sourceProductId: '100',
      stage: 'preview-ready', updatedAt: '2026-08-11T00:00:00Z',
    },
  ];

  assert.deepEqual(filterProductRows(rows, 'warehouse', 'all').map((row) => row.taskId), ['a']);
  assert.deepEqual(filterProductRows(rows, '', 'needs-content').map((row) => row.taskId), ['b']);
  assert.deepEqual(sortProductRows(rows, 'updatedAt', 'desc').map((row) => row.taskId), ['a', 'b']);
  assert.deepEqual(summarizeDashboard([{ id: 'a' }, { id: 'b' }], rows), {
    batchCount: 2,
    productCount: 2,
    readyCount: 1,
    needsAttentionCount: 1,
  });
});
