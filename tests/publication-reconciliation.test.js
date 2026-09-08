import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcilePublication, reconciliationDelayMs } from '../src/publication-reconciliation.js';

const plan = { title: 'Exact title' };
const item = {
  baselineProductIds: ['100'],
  expectedImageIds: ['1', '2', '3', '4', '5', '6'],
  publicationProductId: '200',
};

function dependencies({ listed = ['200'], readable = ['200'], exact = ['200'] } = {}) {
  const loaded = [];
  return {
    loaded,
    listAlibabaProducts: async () => ({
      products: listed.map((productId) => ({ productId, subject: plan.title, categoryId: '301504' })),
    }),
    loadAlibabaProductContext: async (_config, { productId }) => {
      loaded.push(productId);
      if (!readable.includes(productId)) throw new Error('not readable yet');
      return { schemaXml: productId };
    },
    analyzeProductSchema: (schemaXml) => ({ candidateId: schemaXml }),
    comparePublishedProductToPlan: (_plan, analysis) => ({ exactMatch: exact.includes(analysis.candidateId) }),
  };
}

test('returned formal product id is preferred and verified when exact', async () => {
  const deps = dependencies({ listed: ['201', '200'], readable: ['200', '201'], exact: ['200'] });
  assert.deepEqual(await reconcilePublication(deps, { config: {}, plan, item, categoryId: '301504' }), {
    kind: 'verified', productId: '200', candidateProductIds: ['200'],
  });
  assert.equal(deps.loaded[0], '200');
});

test('returned id that is not yet readable remains pending', async () => {
  const deps = dependencies({ listed: ['200'], readable: [], exact: [] });
  assert.deepEqual(await reconcilePublication(deps, { config: {}, plan, item, categoryId: '301504' }), {
    kind: 'pending', candidateProductIds: ['200'],
  });
});

test('lost id recovers exactly one new post-baseline match and ignores baseline products', async () => {
  const deps = dependencies({ listed: ['100', '201'], readable: ['201'], exact: ['100', '201'] });
  const withoutReturnedId = { ...item, publicationProductId: '' };
  assert.deepEqual(await reconcilePublication(deps, {
    config: {}, plan, item: withoutReturnedId, categoryId: '301504', sellingPointBinding: { fieldId: 'summary' },
  }), { kind: 'verified', productId: '201', candidateProductIds: ['201'] });
  assert.deepEqual(deps.loaded, ['201']);
});

test('zero new exact matches remains pending and two are ambiguous', async () => {
  assert.deepEqual(await reconcilePublication(
    dependencies({ listed: ['100'], readable: [], exact: [] }),
    { config: {}, plan, item: { ...item, publicationProductId: '' }, categoryId: '301504' },
  ), { kind: 'pending', candidateProductIds: [] });

  assert.deepEqual(await reconcilePublication(
    dependencies({ listed: ['201', '202'], readable: ['201', '202'], exact: ['201', '202'] }),
    { config: {}, plan, item: { ...item, publicationProductId: '' }, categoryId: '301504' },
  ), { kind: 'ambiguous', candidateProductIds: ['201', '202'] });
});

test('temporary list and render errors stay pending without any write dependency', async () => {
  const write = () => { throw new Error('write must never be called'); };
  assert.deepEqual(await reconcilePublication({
    listAlibabaProducts: async () => { throw new Error('temporary'); },
    loadAlibabaProductContext: async () => { throw new Error('unused'); },
    analyzeProductSchema: () => ({}), comparePublishedProductToPlan: () => ({}), write,
  }, { config: {}, plan, item, categoryId: '301504' }), {
    kind: 'pending', candidateProductIds: ['200'],
  });
});

test('reconciliation delay backs off and stops at the 24 hour deadline', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => reconciliationDelayMs(index)), [
    2000, 5000, 10000, 20000, 30000, 60000, 300000, 300000,
  ]);
  assert.equal(reconciliationDelayMs(0, 24 * 60 * 60 * 1000), null);
});
