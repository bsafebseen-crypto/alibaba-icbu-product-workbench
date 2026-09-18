import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEYS_1688,
  build1688FormValues,
  build1688PublishUiRequest,
  build1688TaskPayload,
  canPublish1688Card,
  choose1688TaskToRestore,
  create1688PublishingState,
  extract1688Categories,
  format1688ConnectionDiagnostic,
  format1688PublicationStatus,
} from '../public/1688-publishing.js';

test('choose1688TaskToRestore restores the most recently updated persisted task', () => {
  assert.equal(choose1688TaskToRestore([]), null);
  assert.equal(choose1688TaskToRestore([
    { id: 'old', updatedAt: '2026-09-15T00:00:00.000Z' },
    { id: 'latest', updatedAt: '2026-09-16T00:00:00.000Z' },
  ]).id, 'latest');
});

test('1688 UI state and browser storage keys are independent from ICBU', () => {
  assert.deepEqual(create1688PublishingState(), {
    refreshToken: '',
    connection: null,
    sdkReady: false,
    categories: [],
    category: null,
    scene: '',
    schemaResponse: null,
    schemaHash: '',
    uploadedImages: [],
    preflight: null,
    task: null,
    publication: null,
    busy: false,
  });
  assert.equal(Object.values(STORAGE_KEYS_1688).every((key) => key.startsWith('icbu-workbench-1688-')), true);
  assert.equal(Object.values(STORAGE_KEYS_1688).some((key) => key.includes('alibaba')), false);
});

test('extract1688Categories tolerates official category response shapes', () => {
  assert.deepEqual(extract1688Categories({ products: [{ categoryID: 1, name: '服装' }] }), [
    { id: '1', name: '服装', categoryType: '' },
  ]);
  assert.deepEqual(extract1688Categories({ categoryInfo: [{ categoryID: 2, categoryName: '背心', categoryType: 3 }] }), [
    { id: '2', name: '背心', categoryType: '3' },
  ]);
});

test('build1688FormValues creates a complete local single-product model', () => {
  const result = build1688FormValues({
    title: '反光安全背心',
    cargoNumber: 'WB-001',
    beginAmount: '2',
    attributesJson: '{"p-1":{"value":2,"text":"涤纶"}}',
    skusJson: '[{"sku_props":[],"sku_price":12.5,"sku_amountOnSale":20,"sku_cargoNumber":"WB-001-R"}]',
    priceRangesJson: '[{"pricerange_beginAmount":2,"pricerange_price":12.5}]',
    detailHtml: '<p>商品详情</p>',
  }, [{ id: 'photo-1', url: 'https://img.example/1.jpg' }]);

  assert.equal(result.title, '反光安全背心');
  assert.equal(result.beginAmount, 2);
  assert.equal(result.catProp['p-1'].text, '涤纶');
  assert.equal(result.skuTable[0].sku_amountOnSale, 20);
  assert.equal(result.priceRange[0].pricerange_price, 12.5);
  assert.equal(result.primaryPicture.imageList[0].url, 'https://img.example/1.jpg');
  assert.equal(result.description.detailList[0].content, '<p>商品详情</p>');
  assert.equal(result.cargoNumber, 'WB-001');
});

test('build1688FormValues reports invalid JSON with a Chinese field name', () => {
  assert.throws(() => build1688FormValues({ attributesJson: '{bad' }, []), /商品属性不是有效 JSON/);
  assert.throws(() => build1688FormValues({ attributesJson: '{}', skusJson: '{bad' }, []), /SKU 不是有效 JSON/);
});

test('connection diagnostics preserve explicit missing permissions', () => {
  assert.deepEqual(format1688ConnectionDiagnostic({
    ok: false,
    message: '未订购方案',
    missing: ['新版商品管理解决方案（商家自用版）'],
    writeReady: false,
  }), {
    tone: 'error',
    message: '未订购方案；缺少：新版商品管理解决方案（商家自用版）',
  });
});

test('canPublish1688Card lists every unmet safety gate', () => {
  assert.deepEqual(canPublish1688Card({
    preflight: { valid: false },
    connection: { ok: false, writeReady: false },
    sdkReady: false,
    task: null,
    publication: null,
  }), {
    allowed: false,
    blockers: ['本地预检未通过', '1688 写权限未验证', '官方前端 JS SDK 未就绪', '任务尚未保存'],
  });
  assert.deepEqual(canPublish1688Card({
    preflight: { valid: true },
    connection: { ok: true, writeReady: true },
    sdkReady: true,
    task: { id: 'task-1' },
    publication: { status: 'ready', writeConsumed: false },
  }), { allowed: true, blockers: [] });
});

test('build1688TaskPayload stores safe local data and exact preview identity', () => {
  const payload = build1688TaskPayload({
    categoryId: '1031910',
    scene: 'popular',
    schemaResponse: { result: { success: true, bizData: '{}' } },
    schemaHash: 'schema-1',
    formValues: { title: '商品', cargoNumber: 'WB-001' },
    fingerprint: 'fp-1',
  });
  assert.equal(payload.product.key, 'product-1');
  assert.equal(payload.product.title, '商品');
  assert.equal(payload.product.cargoNumber, 'WB-001');
  assert.deepEqual(payload.publication, {
    status: 'ready', writeConsumed: false, fingerprint: 'fp-1', schemaHash: 'schema-1',
  });
});

test('build1688PublishUiRequest confirms exactly one saved product', () => {
  assert.deepEqual(build1688PublishUiRequest({
    task: { id: 'task-1', version: 3 },
    publication: { fingerprint: 'fp-1', schemaHash: 'schema-1' },
    config: { appKey: 'key' },
    sdkReady: true,
  }), {
    path: '/api/1688/tasks/task-1/products/product-1/publish',
    body: {
      config: { appKey: 'key' },
      version: 3,
      fingerprint: 'fp-1',
      schemaHash: 'schema-1',
      sdkReady: true,
      confirmation: true,
    },
  });
});

test('format1688PublicationStatus distinguishes uncertain, review and verified states', () => {
  assert.match(format1688PublicationStatus({ status: 'uncertain' }).message, /结果不确定/);
  assert.match(format1688PublicationStatus({ status: 'review_pending', productId: '1' }).message, /审核中/);
  assert.deepEqual(format1688PublicationStatus({ status: 'published_verified', productId: '1' }), {
    tone: 'success', message: '商品 1 已通过官方只读查询核验为已发布',
  });
});
