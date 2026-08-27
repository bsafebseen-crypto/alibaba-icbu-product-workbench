import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLValidator } from 'fast-xml-parser';

import {
  analyzeProductSchema,
  assertOnlyMutableSchemaRolesChanged,
  createProductPreview,
} from '../src/schema-template.js';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'product-schema.xml',
);
const schemaXml = await readFile(fixturePath, 'utf8');

test('analyzeProductSchema recognizes editable roles without treating inherited fields as editable', () => {
  const analysis = analyzeProductSchema(schemaXml);

  assert.equal(analysis.fieldCount, 8);
  assert.deepEqual(analysis.recognized.title, {
    fieldId: 'subject',
    value: 'Original Safety Vest',
  });
  assert.deepEqual(analysis.recognized.productSummary, {
    fieldId: 'product_summary',
    value: 'Original summary',
  });
  assert.deepEqual(analysis.recognized.faq, {
    fieldId: 'product_faq',
    items: [
      { question: 'Original question 1?', answer: 'Original answer 1.' },
      { question: 'Original question 2?', answer: 'Original answer 2.' },
      { question: 'Original question 3?', answer: 'Original answer 3.' },
      { question: 'Original question 4?', answer: 'Original answer 4.' },
      { question: 'Original question 5?', answer: 'Original answer 5.' },
      { question: 'Keep question 6?', answer: 'Keep answer 6.' },
    ],
  });
  assert.deepEqual(analysis.recognized.customAttributes, {
    fieldId: 'custom_attributes',
    items: [
      { name: 'Material', value: 'Polyester' },
      { name: 'Closure Style', value: 'Front Zipper' },
    ],
  });
  assert.deepEqual(analysis.warnings, []);
});

test('analyzeProductSchema reports missing editable roles instead of guessing', () => {
  const analysis = analyzeProductSchema('<itemSchema><field id="price"><input value="9.99" /></field></itemSchema>');

  assert.equal(analysis.fieldCount, 1);
  assert.equal(analysis.recognized.title, null);
  assert.equal(analysis.recognized.productSummary, null);
  assert.equal(analysis.recognized.faq, null);
  assert.equal(analysis.recognized.customAttributes, null);
  assert.deepEqual(analysis.warnings, [
    '未识别标题字段',
    '未识别主题卖点字段',
    '未识别 FAQ 字段',
    '未识别自定义属性字段',
  ]);
});

test('analyzeProductSchema rejects malformed XML', () => {
  assert.throws(
    () => analyzeProductSchema('<itemSchema><field></itemSchema>'),
    /Schema XML 无效/,
  );
});

test('createProductPreview changes only the three editable roles and keeps source XML immutable', () => {
  const faqItems = Array.from({ length: 5 }, (_, index) => ({
    question: `Variant question ${index + 1}?`,
    answer: `Variant answer ${index + 1}.`,
  }));
  const first = createProductPreview(schemaXml, {
    title: 'Variant One',
    sellingPoints: 'Summary One',
    faqItems,
    customAttributes: [
      { name: 'Material', value: 'Polyester' },
      { name: 'Closure Style', value: 'Smooth Front Zipper' },
    ],
  });
  const second = createProductPreview(schemaXml, {
    title: 'Variant Two',
    sellingPoints: 'Summary Two',
    faqItems,
    customAttributes: [
      { name: 'Material', value: 'Polyester' },
      { name: 'Closure Style', value: 'Front Zipper' },
    ],
  });

  assert.deepEqual(first.changedFields, ['title', 'productSummary', 'faq', 'customAttributes']);
  assert.deepEqual(first.warnings, []);
  assert.equal(analyzeProductSchema(first.previewXml).recognized.title.value, 'Variant One');
  assert.equal(analyzeProductSchema(first.previewXml).recognized.productSummary.value, 'Summary One');
  assert.deepEqual(analyzeProductSchema(first.previewXml).recognized.faq.items.slice(0, 5), faqItems);
  assert.deepEqual(analyzeProductSchema(first.previewXml).recognized.faq.items[5], {
    question: 'Keep question 6?', answer: 'Keep answer 6.',
  });
  assert.deepEqual(analyzeProductSchema(first.previewXml).recognized.customAttributes.items, [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Smooth Front Zipper' },
  ]);
  assert.equal(analyzeProductSchema(second.previewXml).recognized.title.value, 'Variant Two');
  assert.match(first.previewXml, /12\.50/);
  assert.match(first.previewXml, /SKU-001/);
  assert.match(first.previewXml, /keep-me/);
  assert.match(schemaXml, /Original Safety Vest/);
});

test('createProductPreview rejects a title longer than 128 characters', () => {
  assert.throws(() => createProductPreview(schemaXml, {
    title: 'x'.repeat(129),
    sellingPoints: 'Summary',
    faqItems: Array.from({ length: 5 }, () => ({ question: 'Question?', answer: 'Answer.' })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
  }), /标题不能超过 128 个字符/);
});

test('createProductPreview rejects incomplete FAQ pairs', () => {
  assert.throws(() => createProductPreview(schemaXml, {
    title: 'Variant',
    sellingPoints: 'Summary',
    faqItems: [{ question: 'Question without an answer?', answer: '' }],
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
  }), /FAQ 必须正好包含前 5 组问答/);
});

test('createProductPreview refuses to guess when an editable role is missing', () => {
  const incomplete = '<itemSchema><field id="subject"><input value="Title" /></field></itemSchema>';
  assert.throws(() => createProductPreview(incomplete, {
    title: 'Variant',
    sellingPoints: 'Summary',
    faq: 'Q: Question?\nA: Answer.',
  }), /Schema 缺少可安全替换的字段/);
});

const renderedAlibabaSchemaXml = `
<itemSchema>
  <field id="productTitle" name="商品名称" type="text">
    <rules><rule name="tipRule" value="title help text" /></rules>
    <value>Original Alibaba Title</value>
  </field>
  <field id="textDesc" name="商品卖点" type="textarea">
    <value>Original Alibaba Summary</value>
  </field>
  <field id="companyFaqDesc" name="FAQs" type="multiComplex">
    <complex-values><field id="question" type="input"><value>Question 1?</value></field><field id="answers" type="input"><value>Answer 1.</value></field></complex-values>
    <complex-values><field id="question" type="input"><value>Question 2?</value></field><field id="answers" type="input"><value>Answer 2.</value></field></complex-values>
    <complex-values><field id="question" type="input"><value>Question 3?</value></field><field id="answers" type="input"><value>Answer 3.</value></field></complex-values>
    <complex-values><field id="question" type="input"><value>Question 4?</value></field><field id="answers" type="input"><value>Answer 4.</value></field></complex-values>
    <complex-values><field id="question" type="input"><value>Question 5?</value></field><field id="answers" type="input"><value>Answer 5.</value></field></complex-values>
    <complex-values><field id="question" type="input"><value>Keep question 6?</value></field><field id="answers" type="input"><value>Keep answer 6.</value></field></complex-values>
  </field>
  <field id="customMoreProperty" name="自定义属性" type="complex">
    <complex-value><field id="customMoreProperty_0" type="complex"><complex-value><field id="valueName" type="input"><value>Polyester</value></field><field id="propName" type="input"><value>Material</value></field></complex-value></field></complex-value>
    <complex-value><field id="customMoreProperty_1" type="complex"><complex-value><field id="valueName" type="input"><value>Front Zipper</value></field><field id="propName" type="input"><value>Closure Style</value></field></complex-value></field></complex-value>
  </field>
  <field id="scImages" type="complex">
    <complex-value><field id="scImages_0"><value fileId="old-0">https://img/old-0.jpg</value></field></complex-value>
    <complex-value><field id="scImages_1"><value fileId="old-1">https://img/old-1.jpg</value></field></complex-value>
  </field>
  <field id="sku"><value>KEEP-SKU</value></field>
</itemSchema>`;

const confirmedSellingPointBinding = {
  fieldId: 'textDesc',
  carrierPath: ['value'],
  structureType: 'single-text',
};

test('analyzeProductSchema reads real Alibaba render value nodes instead of rule hints', () => {
  const analysis = analyzeProductSchema(renderedAlibabaSchemaXml);

  assert.deepEqual(analysis.recognized.title, {
    fieldId: 'productTitle',
    value: 'Original Alibaba Title',
  });
  assert.deepEqual(analysis.recognized.productSummary, {
    fieldId: 'textDesc',
    value: 'Original Alibaba Summary',
    confirmed: false,
  });
  assert.deepEqual(analysis.recognized.faq.items.slice(0, 2), [
    { question: 'Question 1?', answer: 'Answer 1.' },
    { question: 'Question 2?', answer: 'Answer 2.' },
  ]);
  assert.deepEqual(analysis.recognized.customAttributes.items, [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Front Zipper' },
  ]);
  assert.deepEqual(analysis.recognized.images, {
    fieldId: 'scImages',
    items: [
      { fileId: 'old-0', url: 'https://img/old-0.jpg' },
      { fileId: 'old-1', url: 'https://img/old-1.jpg' },
    ],
  });
  assert.deepEqual(analysis.warnings, []);
});

test('createProductPreview blocks an unconfirmed textDesc selling-point field', () => {
  assert.throws(() => createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New Alibaba Title',
    sellingPoints: 'New Alibaba Summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({
      question: `New question ${index + 1}?`,
      answer: `New answer ${index + 1}.`,
    })),
    customAttributes: [{ name: 'Material', value: 'Oxford Polyester' }],
  }), /卖点字段尚未校准/);
});

test('createProductPreview writes a confirmed Alibaba selling-point carrier and preserves later FAQ rows', () => {
  const faqItems = Array.from({ length: 5 }, (_, index) => ({
    question: `New question ${index + 1}?`,
    answer: `New answer ${index + 1}.`,
  }));

  const preview = createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New Alibaba Title',
    sellingPoints: 'New Alibaba Summary',
    faqItems,
    customAttributes: [
      { name: 'Material', value: 'Oxford Polyester' },
      { name: 'Closure Style', value: 'Smooth Front Zipper' },
    ],
    sellingPointBinding: confirmedSellingPointBinding,
  });
  const analysis = analyzeProductSchema(preview.previewXml, {
    sellingPointBinding: confirmedSellingPointBinding,
  });

  assert.equal(analysis.recognized.title.value, 'New Alibaba Title');
  assert.equal(analysis.recognized.productSummary.value, 'New Alibaba Summary');
  assert.equal(analysis.recognized.productSummary.confirmed, true);
  assert.deepEqual(analysis.recognized.faq.items.slice(0, 5), faqItems);
  assert.deepEqual(analysis.recognized.faq.items[5], {
    question: 'Keep question 6?', answer: 'Keep answer 6.',
  });
  assert.deepEqual(analysis.recognized.customAttributes.items, [
    { name: 'Material', value: 'Oxford Polyester' },
    { name: 'Closure Style', value: 'Smooth Front Zipper' },
  ]);
  assert.match(preview.previewXml, /KEEP-SKU/);
});

test('createProductPreview replaces scImages with six Alibaba photo-bank images', () => {
  const alibabaImages = Array.from({ length: 6 }, (_, index) => ({
    fileId: `new-${index}`,
    url: `https://img/new-${index}.jpg`,
  }));
  const preview = createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({
      question: `Q${index}?`,
      answer: `A${index}.`,
    })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    alibabaImages,
    sellingPointBinding: confirmedSellingPointBinding,
  });

  assert.deepEqual(analyzeProductSchema(preview.previewXml).recognized.images.items, alibabaImages);
  assert.deepEqual(preview.changedFields, [
    'title', 'productSummary', 'faq', 'customAttributes', 'images',
  ]);
  assert.match(preview.previewXml, /KEEP-SKU/);
  assert.doesNotMatch(preview.previewXml, /old-0/);
});

test('createProductPreview replaces scImages stored in one shared image container', () => {
  const compactImageSchemaXml = renderedAlibabaSchemaXml.replace(
    '<complex-value><field id="scImages_0"><value fileId="old-0">https://img/old-0.jpg</value></field></complex-value>\n    <complex-value><field id="scImages_1"><value fileId="old-1">https://img/old-1.jpg</value></field></complex-value>',
    '<complex-value><field id="scImages_0"><value fileId="old-0">https://img/old-0.jpg</value></field><field id="scImages_1"><value fileId="old-1">https://img/old-1.jpg</value></field></complex-value>',
  );
  assert.notEqual(compactImageSchemaXml, renderedAlibabaSchemaXml);
  const alibabaImages = Array.from({ length: 6 }, (_, index) => ({
    fileId: `shared-${index}`,
    url: `https://img/shared-${index}.jpg`,
  }));

  const preview = createProductPreview(compactImageSchemaXml, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({
      question: `Q${index}?`,
      answer: `A${index}.`,
    })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    alibabaImages,
    sellingPointBinding: confirmedSellingPointBinding,
  });

  assert.deepEqual(analyzeProductSchema(preview.previewXml).recognized.images.items, alibabaImages);
  assert.doesNotMatch(preview.previewXml, /old-0|old-1/);
});

test('createProductPreview rejects incomplete Alibaba image metadata', () => {
  assert.throws(() => createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, () => ({
      question: 'Question?',
      answer: 'Answer.',
    })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    alibabaImages: Array.from({ length: 6 }, () => ({
      fileId: '',
      url: 'https://img/x.jpg',
    })),
    sellingPointBinding: confirmedSellingPointBinding,
  }), /fileId 和 URL/);
});

test('assertOnlyMutableSchemaRolesChanged identifies the first protected field change', () => {
  assert.throws(
    () => assertOnlyMutableSchemaRolesChanged(
      renderedAlibabaSchemaXml,
      renderedAlibabaSchemaXml.replace('KEEP-SKU', 'CHANGED-SKU'),
    ),
    /field\[id=sku\]\.value/,
  );
});

test('assertOnlyMutableSchemaRolesChanged ignores parser type drift after XML rebuilding', () => {
  const schemaWithBooleanRule = renderedAlibabaSchemaXml.replace(
    '<itemSchema>',
    '<itemSchema><field id="catId"><rules><rule value="keep"/><rule value="true"/></rules></field>',
  );
  const preview = createProductPreview(schemaWithBooleanRule, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({
      question: `Q${index}?`,
      answer: `A${index}.`,
    })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    sellingPointBinding: confirmedSellingPointBinding,
  });

  assert.doesNotThrow(() => (
    assertOnlyMutableSchemaRolesChanged(schemaWithBooleanRule, preview.previewXml)
  ));
});

test('createProductPreview keeps true-valued Alibaba attributes as valid XML', () => {
  const schemaWithTrueAttribute = renderedAlibabaSchemaXml.replace(
    '<itemSchema>',
    '<itemSchema><field id="catId"><rules><rule name="readOnlyRule" value="true"/></rules><value>301504</value></field>',
  );
  const preview = createProductPreview(schemaWithTrueAttribute, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({
      question: `Q${index}?`,
      answer: `A${index}.`,
    })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    sellingPointBinding: confirmedSellingPointBinding,
  });

  assert.equal(XMLValidator.validate(preview.previewXml), true);
  assert.match(preview.previewXml, /readOnlyRule" value="true"/);
});
