import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createKeywordRecordStore } from '../src/keyword-record-store.js';

async function createStore() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'keyword-records-'));
  let sequence = 0;
  return createKeywordRecordStore(rootDir, {
    now: () => new Date('2026-09-17T00:00:00.000Z'),
    randomUUID: () => `record-${++sequence}`,
  });
}

test('keyword record store starts empty and persists trimmed unique numeric Product IDs', async () => {
  const store = await createStore();
  assert.deepEqual(await store.readAll(), {
    products: [], inquiry_keywords: [], blocked_keywords: [],
  });

  const data = await store.addProduct({ product_id: ' 1601954851686 ' });
  assert.equal(data.products[0].product_id, '1601954851686');
  assert.equal(data.products[0].created_at, '2026-09-17T00:00:00.000Z');
  assert.deepEqual(await store.readAll(), data);
  await assert.rejects(() => store.addProduct({ product_id: '1601954851686' }), /已存在/);
  await assert.rejects(() => store.addProduct({ product_id: 'ABC' }), /只能包含数字/);
  await assert.rejects(() => store.addProduct({ product_id: '   ' }), /不能为空/);
});

test('removing a Product ID cascades inquiry keywords but retains blocked keywords', async () => {
  const store = await createStore();
  let data = await store.addProduct({ product_id: '1601954851686' });
  const productId = data.products[0].id;
  await store.addInquiryKeyword({ product_id: '1601954851686', keyword: 'reflective vest' });
  await store.addBlockedKeyword({ product_id: '1601954851686', keyword: 'fashion vest' });

  data = await store.removeProduct(productId);
  assert.equal(data.products.length, 0);
  assert.equal(data.inquiry_keywords.length, 0);
  assert.equal(data.blocked_keywords.length, 1);
  await assert.rejects(() => store.removeProduct('missing'), /不存在/);
});

test('inquiry keyword batch import trims lines and skips case-insensitive duplicates', async () => {
  const store = await createStore();
  await store.addProduct({ product_id: '1601954851686' });
  const result = await store.batchAddInquiryKeywords({
    product_id: '1601954851686',
    keywords: ' reflective safety vest\n\nHIGH VISIBILITY VEST\nreflective safety vest ',
  });
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.data.inquiry_keywords.map((item) => item.keyword), [
    'reflective safety vest', 'HIGH VISIBILITY VEST',
  ]);

  const existing = result.data.inquiry_keywords[0];
  const updated = await store.updateInquiryKeyword(existing.id, {
    keyword: ' reflective workwear ', note: ' 重点词 ',
  });
  assert.deepEqual(updated.inquiry_keywords[0], {
    ...existing,
    keyword: 'reflective workwear',
    note: '重点词',
  });
  await assert.rejects(() => store.addInquiryKeyword({
    product_id: '999', keyword: 'vest',
  }), /Product ID 不存在/);
  await assert.rejects(() => store.updateInquiryKeyword(existing.id, {
    keyword: 'high visibility vest',
  }), /已存在/);
  const removed = await store.removeInquiryKeyword(existing.id);
  assert.equal(removed.inquiry_keywords.length, 1);
});

test('blocked keyword uniqueness includes the nullable Product ID', async () => {
  const store = await createStore();
  await store.addProduct({ product_id: '1601954851686' });
  const first = await store.batchAddBlockedKeywords({
    product_id: null,
    keywords: 'fashion vest\nFASHION VEST\ncycling clothing',
  });
  assert.deepEqual({ added: first.added, skipped: first.skipped }, { added: 2, skipped: 1 });

  const second = await store.addBlockedKeyword({
    product_id: '1601954851686', keyword: 'fashion vest', note: ' 产品不相关 ',
  });
  assert.equal(second.blocked_keywords.length, 3);
  const record = second.blocked_keywords[2];
  assert.equal(record.note, '产品不相关');
  assert.equal(record.product_id, '1601954851686');

  const updated = await store.updateBlockedKeyword(record.id, {
    product_id: '', keyword: 'pet vest', note: '',
  });
  const edited = updated.blocked_keywords.find((item) => item.id === record.id);
  assert.equal(edited.product_id, null);
  assert.equal(edited.created_at, record.created_at);
  await assert.rejects(() => store.addBlockedKeyword({ keyword: ' ' }), /不能为空/);
  await assert.rejects(() => store.addBlockedKeyword({ product_id: 'ABC', keyword: 'vest' }), /只能包含数字/);
  const removed = await store.removeBlockedKeyword(record.id);
  assert.equal(removed.blocked_keywords.length, 2);
});
