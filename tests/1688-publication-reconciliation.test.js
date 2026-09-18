import test from 'node:test';
import assert from 'node:assert/strict';

import {
  next1688ReconciliationAt,
  reconcile1688Publication,
} from '../src/1688-publication-reconciliation.js';

function publication(overrides = {}) {
  return {
    status: 'verify_pending',
    writeConsumed: true,
    fingerprint: 'fp-1',
    schemaHash: 'schema-1',
    productId: '706291373455',
    cargoNumber: 'WB-001',
    categoryId: '1031910',
    title: '反光背心',
    startedAt: '2026-09-16T01:00:00.000Z',
    reconciliationAttempts: 0,
    ...overrides,
  };
}

test('known product ids are verified with the readonly product.get result', async () => {
  const calls = [];
  const result = await reconcile1688Publication(publication(), {
    async getProduct(id) {
      calls.push(['get', id]);
      return {
        productInfo: {
          productID: 706291373455,
          cargoNumber: 'WB-001',
          categoryID: 1031910,
          subject: '反光背心',
          status: 'published',
        },
      };
    },
    async listProducts() { throw new Error('不应查询列表'); },
    async publishProduct() { throw new Error('不得写入'); },
  }, '2026-09-16T01:00:02.000Z');

  assert.deepEqual(calls, [['get', '706291373455']]);
  assert.equal(result.status, 'published_verified');
  assert.equal(result.productId, '706291373455');
  assert.equal(result.offerStatus, 'published');
  assert.equal(result.verifiedAt, '2026-09-16T01:00:02.000Z');
});

test('auditing products remain review_pending and are not claimed as published', async () => {
  const result = await reconcile1688Publication(publication(), {
    async getProduct() {
      return { productInfo: { productID: 706291373455, cargoNumber: 'WB-001', categoryID: 1031910, subject: '反光背心', status: 'auditing' } };
    },
  }, '2026-09-16T01:00:02.000Z');

  assert.equal(result.status, 'review_pending');
  assert.equal(result.offerStatus, 'auditing');
  assert.equal(result.verifiedAt, undefined);
  assert.match(result.nextCheckAt, /^2026-09-16T01:00:04/);
});

test('rejected products retain the official failure reason', async () => {
  const result = await reconcile1688Publication(publication(), {
    async getProduct() {
      return {
        productInfo: { productID: '706291373455', cargoNumber: 'WB-001', categoryID: '1031910', subject: '反光背心', status: 'untread' },
        errMsg: '标题包含违禁词',
      };
    },
  }, '2026-09-16T01:00:02.000Z');

  assert.equal(result.status, 'verification_failed');
  assert.equal(result.errorCode, 'OFFER_UNTREAD');
  assert.equal(result.errorMessage, '标题包含违禁词');
});

test('unknown product ids are resolved only by a unique readonly cargo-number match', async () => {
  let filters;
  const result = await reconcile1688Publication(publication({ productId: '', status: 'uncertain' }), {
    async listProducts(input) {
      filters = input;
      return {
        result: {
          productInfos: [{
            productID: 706291373455,
            cargoNumber: 'WB-001',
            categoryID: 1031910,
            subject: '反光背心',
            status: 'published',
          }],
        },
      };
    },
  }, '2026-09-16T01:00:05.000Z');

  assert.equal(filters.cargoNumber, 'WB-001');
  assert.equal(filters.categoryId, '1031910');
  assert.equal(filters.pageNo, 1);
  assert.equal(filters.pageSize, 20);
  assert.equal(filters.startPublishTime, '2026-09-16T00:55:00.000Z');
  assert.equal(result.status, 'published_verified');
  assert.equal(result.productId, '706291373455');
});

test('zero matches remain uncertain and schedule another readonly check', async () => {
  const result = await reconcile1688Publication(publication({ productId: '', status: 'uncertain' }), {
    async listProducts() { return { result: { productInfos: [] } }; },
  }, '2026-09-16T01:00:05.000Z');

  assert.equal(result.status, 'uncertain');
  assert.equal(result.reconciliationAttempts, 1);
  assert.equal(result.nextCheckAt, '2026-09-16T01:00:07.000Z');
});

test('multiple matches become ambiguous and are never selected automatically', async () => {
  const result = await reconcile1688Publication(publication({ productId: '', status: 'uncertain' }), {
    async listProducts() {
      return { result: { productInfos: [{ productID: '1' }, { productID: '2' }] } };
    },
  }, '2026-09-16T01:00:05.000Z');

  assert.equal(result.status, 'verification_ambiguous');
  assert.deepEqual(result.candidateProductIds, ['1', '2']);
  assert.equal(result.productId, '');
});

test('mismatched product identity fails verification instead of accepting HTTP success', async () => {
  const result = await reconcile1688Publication(publication(), {
    async getProduct() {
      return { productInfo: { productID: '706291373455', cargoNumber: 'OTHER', categoryID: '1031910', subject: '反光背心', status: 'published' } };
    },
  }, '2026-09-16T01:00:02.000Z');

  assert.equal(result.status, 'verification_failed');
  assert.equal(result.errorCode, 'IDENTITY_MISMATCH');
});

test('the readonly backoff schedule is bounded and deterministic', () => {
  const now = '2026-09-16T01:00:00.000Z';
  assert.equal(next1688ReconciliationAt(now, 0), '2026-09-16T01:00:02.000Z');
  assert.equal(next1688ReconciliationAt(now, 1), '2026-09-16T01:00:05.000Z');
  assert.equal(next1688ReconciliationAt(now, 6), '2026-09-16T01:05:00.000Z');
  assert.equal(next1688ReconciliationAt(now, 99), '2026-09-16T01:05:00.000Z');
});
