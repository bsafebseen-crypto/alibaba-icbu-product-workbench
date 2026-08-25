import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createObsidianPublishingState,
  remainingPlans,
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
