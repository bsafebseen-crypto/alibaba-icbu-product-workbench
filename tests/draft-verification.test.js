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

test('compareDraftToPlan rejects selling points read from an unconfirmed field', () => {
  const analysis = matchingAnalysis();
  analysis.recognized.productSummary.confirmed = false;

  const result = compareDraftToPlan(plan, analysis);

  assert.equal(result.exactMatch, false);
  assert.deepEqual(result.fields.sellingPoints, {
    match: false,
    expected: 'Expected selling points',
    actual: 'Expected selling points',
    fieldConfirmed: false,
  });
  assert.deepEqual(result.differences, ['sellingPoints']);
});

test('compareDraftToPlan identifies reordered, missing, unexpected, and changed attributes', () => {
  const analysis = matchingAnalysis();
  const actual = analysis.recognized.customAttributes.items;
  [actual[0], actual[1]] = [actual[1], actual[0]];
  actual[2].value = 'Changed value';
  actual.splice(3, 1);
  actual.push({ name: 'Extra', value: 'Extra value' });

  const result = compareDraftToPlan(plan, analysis);

  assert.equal(result.fields.customAttributes.match, false);
  assert.deepEqual(result.fields.customAttributes.details, {
    orderMatch: false,
    missing: [{ name: 'Attribute 4', value: 'Value 4' }],
    unexpected: [{ name: 'Extra', value: 'Extra value' }],
    changed: [{ name: 'Attribute 3', expectedValue: 'Value 3', actualValue: 'Changed value' }],
  });
});

test('compareDraftToPlan treats attribute order-only changes as matching content', () => {
  const analysis = matchingAnalysis();
  analysis.recognized.customAttributes.items.reverse();

  const result = compareDraftToPlan(plan, analysis);

  assert.equal(result.exactMatch, true);
  assert.deepEqual(result.differences, []);
  assert.deepEqual(result.fields.customAttributes, {
    match: true,
    expectedCount: 10,
    actualCount: 10,
    orderChanged: true,
  });
});
