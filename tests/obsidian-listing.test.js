import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractListingPayload,
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
  return [
    '# Human-readable listing',
    '',
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
