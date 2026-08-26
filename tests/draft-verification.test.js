import test from 'node:test';
import assert from 'node:assert/strict';

import { compareDraftToPlan } from '../src/draft-verification.js';

const plan = {
  title: 'Expected title',
  sellingPoints: 'Expected selling points',
  faqs: Array.from({ length: 5 }, (_, index) => ({ question: `Question ${index + 1}?`, answer: `Answer ${index + 1}.` })),
  customAttributes: Array.from({ length: 10 }, (_, index) => ({ name: `Attribute ${index + 1}`, value: `Value ${index + 1}` })),
};

function matchingAnalysis() {
  return {
    recognized: {
      title: { value: plan.title },
      productSummary: { value: plan.sellingPoints },
      faq: { items: structuredClone(plan.faqs) },
      customAttributes: { items: structuredClone(plan.customAttributes) },
      images: { items: Array.from({ length: 6 }, (_, index) => ({ fileId: `file-${index}`, url: `https://img/${index}.jpg` })) },
    },
  };
}

test('compareDraftToPlan reports exact listing content and complete six-image metadata', () => {
  assert.deepEqual(compareDraftToPlan(plan, matchingAnalysis()), {
    exactMatch: true,
    fields: {
      title: { match: true, expected: 'Expected title', actual: 'Expected title' },
      sellingPoints: { match: true, expected: 'Expected selling points', actual: 'Expected selling points' },
      faqs: { match: true, expectedCount: 5, actualCount: 5 },
      customAttributes: { match: true, expectedCount: 10, actualCount: 10 },
      images: { match: true, expectedCount: 6, actualCount: 6, completeMetadata: true },
    },
    differences: [],
  });
});

test('compareDraftToPlan reports field differences without returning raw XML', () => {
  const analysis = matchingAnalysis();
  analysis.recognized.title.value = 'Different title';
  analysis.recognized.faq.items[2] = { question: 'Different?', answer: 'Different.' };
  analysis.recognized.images.items[5].fileId = '';

  const result = compareDraftToPlan(plan, analysis);

  assert.equal(result.exactMatch, false);
  assert.deepEqual(result.differences, ['title', 'faqs', 'images']);
  assert.deepEqual(result.fields.images, {
    match: false, expectedCount: 6, actualCount: 6, completeMetadata: false,
  });
  assert.equal(JSON.stringify(result).includes('schemaXml'), false);
});
