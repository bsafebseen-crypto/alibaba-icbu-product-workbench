import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSellingPointBinding } from '../src/schema-role-binding.js';

test('validateSellingPointBinding rejects title and price text fields', () => {
  const schemaXml = [
    '<itemSchema>',
    '<field id="subject" name="Product Title"><value>Reflective shirt</value></field>',
    '<field id="price" name="Price"><value>9.99</value></field>',
    '</itemSchema>',
  ].join('');

  for (const fieldId of ['subject', 'price']) {
    assert.throws(
      () => validateSellingPointBinding(schemaXml, {
        fieldId, carrierPath: ['value'], structureType: 'single-text',
      }),
      /真实卖点候选字段/,
    );
  }
});
