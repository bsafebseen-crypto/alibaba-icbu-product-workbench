import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createObsidianVariants,
  createStrictProductPreview,
} from '../src/obsidian-variant.js';
import { analyzeProductSchema } from '../src/schema-template.js';

function listingBatch() {
  return {
    plans: Array.from({ length: 5 }, (_, index) => ({
      id: `plan-${index + 1}`,
      title: `Safety Vest Variant ${index + 1}`,
      sellingPoints: `Summary ${index + 1}`,
      faqs: Array.from({ length: 5 }, (_, faqIndex) => ({
        question: `P${index + 1} question ${faqIndex + 1}?`,
        answer: `P${index + 1} answer ${faqIndex + 1}.`,
      })),
      customAttributes: Array.from({ length: 10 }, (_, attributeIndex) => ({
        name: `Custom ${attributeIndex + 1}`,
        value: `Value ${index + 1}-${attributeIndex + 1}`,
      })),
    })),
  };
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'product-schema.xml');
const baseSchema = await readFile(fixturePath, 'utf8');
const schemaXml = baseSchema.replace('</itemSchema>', `
  <field id="scImages" type="complex">
    <complex-value><field id="scImages_0"><value fileId="old-0">https://img/old-0.jpg</value></field></complex-value>
  </field>
</itemSchema>`);

test('createObsidianVariants excludes the selected base and returns four strict variants', () => {
  const variants = createObsidianVariants(listingBatch(), 'plan-2');
  assert.deepEqual(variants.map(({ planId }) => planId), ['plan-1', 'plan-3', 'plan-4', 'plan-5']);
  assert.equal(variants[0].faqItems.length, 5);
  assert.equal(variants[0].customAttributes.length, 10);
});

test('createObsidianVariants rejects invalid title and attribute counts', () => {
  const longTitle = listingBatch();
  longTitle.plans[0].title = 'x'.repeat(129);
  assert.throws(() => createObsidianVariants(longTitle, 'plan-2'), /标题不能超过 128 个字符/);

  const shortAttributes = listingBatch();
  shortAttributes.plans[0].customAttributes.pop();
  assert.throws(() => createObsidianVariants(shortAttributes, 'plan-2'), /必须正好包含 10 条自定义属性/);
});

test('createStrictProductPreview replaces five mutable roles and fingerprints the result', () => {
  const variant = createObsidianVariants(listingBatch(), 'plan-2')[0];
  const alibabaImages = Array.from({ length: 6 }, (_, index) => ({
    fileId: `new-${index}`,
    url: `https://img/new-${index}.jpg`,
  }));

  const result = createStrictProductPreview(schemaXml, { ...variant, alibabaImages });
  const analysis = analyzeProductSchema(result.previewXml);

  assert.deepEqual(result.changedFields, [
    'title', 'productSummary', 'faq', 'customAttributes', 'images',
  ]);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.values(result.preservedFields).every(Boolean), true);
  assert.equal(analysis.recognized.customAttributes.items.length, 10);
  assert.deepEqual(analysis.recognized.images.items, alibabaImages);
  assert.match(result.previewXml, /SKU-001/);
  assert.match(result.previewXml, /12\.50/);
  assert.match(result.previewXml, /keep-me/);
});

test('createStrictProductPreview requires six complete photo-bank images', () => {
  const variant = createObsidianVariants(listingBatch(), 'plan-2')[0];
  assert.throws(
    () => createStrictProductPreview(schemaXml, { ...variant, alibabaImages: [] }),
    /必须正好包含 1 张主图和 5 张副图/,
  );
});

test('createStrictProductPreview rejects the actual oversized size reference with its plan and field', () => {
  const variant = createObsidianVariants(listingBatch(), 'plan-1')[0];
  const value = 'M L XL 2XL 3XL shown in the image guide with final measurements to confirm';
  variant.customAttributes[9] = { name: 'Size Reference', value };
  const alibabaImages = Array.from({ length: 6 }, (_, index) => ({
    fileId: `new-${index}`, url: `https://img/new-${index}.jpg`,
  }));

  assert.equal(value.length, 74);
  assert.throws(
    () => createStrictProductPreview(schemaXml, { ...variant, alibabaImages }),
    /plan-2.*自定义属性 10.*Size Reference.*74.*70/,
  );
  assert.equal(variant.customAttributes[9].value, value);
});
