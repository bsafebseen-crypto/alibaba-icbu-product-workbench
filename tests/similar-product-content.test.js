import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAttributeChanges,
  assignProductImages,
  validateSimilarProductGeneration,
} from '../src/similar-product-content.js';

const fourMainImages = ['main-1.jpg', 'main-2.jpg', 'main-3.jpg', 'main-4.jpg'];
const sixAuxiliaryImages = ['aux-1.jpg', 'aux-2.jpg', 'aux-3.jpg', 'aux-4.jpg', 'aux-5.jpg', 'aux-6.jpg'];

test('assignProductImages maps four main images and rotates five unique auxiliary images', () => {
  assert.deepEqual(assignProductImages(fourMainImages, sixAuxiliaryImages), [
    { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    { mainImageIndex: 1, auxiliaryImageIndexes: [1, 2, 3, 4, 5] },
    { mainImageIndex: 2, auxiliaryImageIndexes: [2, 3, 4, 5, 0] },
    { mainImageIndex: 3, auxiliaryImageIndexes: [3, 4, 5, 0, 1] },
  ]);
});

test('assignProductImages rejects missing main or auxiliary images', () => {
  assert.throws(
    () => assignProductImages(['main.jpg'], sixAuxiliaryImages),
    /需要正好 4 张主图/,
  );
  assert.throws(
    () => assignProductImages(fourMainImages, ['a.jpg', 'b.jpg']),
    /至少需要 5 张副图/,
  );
});

test('applyAttributeChanges applies add, update, and delete while preserving untouched order', () => {
  const source = [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Front Zipper' },
    { name: 'Use', value: 'Traffic Control' },
  ];
  const result = applyAttributeChanges(source, [
    { operation: 'update', name: 'Closure Style', after: 'Smooth Front Zipper' },
    { operation: 'delete', name: 'Use' },
    { operation: 'add', name: 'Pocket Type', after: 'Chest and Lower Pockets' },
  ]);

  assert.deepEqual(result.attributes, [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Smooth Front Zipper' },
    { name: 'Pocket Type', value: 'Chest and Lower Pockets' },
  ]);
  assert.deepEqual(result.changes, [
    {
      operation: 'update',
      name: 'Closure Style',
      before: 'Front Zipper',
      after: 'Smooth Front Zipper',
    },
    { operation: 'delete', name: 'Use', before: 'Traffic Control', after: '' },
    { operation: 'add', name: 'Pocket Type', before: '', after: 'Chest and Lower Pockets' },
  ]);
  assert.equal(source[1].value, 'Front Zipper');
});

test('applyAttributeChanges rejects unsafe or ambiguous changes', () => {
  const source = [{ name: 'Material', value: 'Polyester' }];
  assert.throws(
    () => applyAttributeChanges(source, Array.from({ length: 6 }, (_, index) => ({
      operation: 'add', name: `New ${index}`, after: `Value ${index}`,
    }))),
    /最多只能改动 5 个自定义属性/,
  );
  assert.throws(
    () => applyAttributeChanges(source, [{ operation: 'update', name: 'Unknown', after: 'Value' }]),
    /找不到要修改的自定义属性/,
  );
  assert.throws(
    () => applyAttributeChanges(source, [{ operation: 'add', name: 'material', after: 'Cotton' }]),
    /自定义属性名重复/,
  );
});

function generatedProduct(index, overrides = {}) {
  return {
    title: `Reflective Safety Vest Variant ${index}`,
    sellingPoints: `Selling point ${index}`,
    faqItems: Array.from({ length: 5 }, (_, faqIndex) => ({
      question: `Question ${faqIndex + 1}?`,
      answer: `Answer ${faqIndex + 1}.`,
    })),
    attributeChanges: [
      { operation: 'update', name: 'Closure Style', after: `Zipper ${index}` },
    ],
    keywords: ['safety vest'],
    ...overrides,
  };
}

const generationContext = {
  allowedKeywords: ['safety vest', 'reflective workwear'],
  sourceAttributes: [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Front Zipper' },
  ],
  imageAssignments: [
    { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    { mainImageIndex: 1, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    { mainImageIndex: 2, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    { mainImageIndex: 3, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
  ],
};

test('validateSimilarProductGeneration returns four normalized products with applied attributes', () => {
  const products = validateSimilarProductGeneration({
    products: Array.from({ length: 4 }, (_, index) => generatedProduct(index + 1)),
  }, generationContext);

  assert.equal(products.length, 4);
  assert.equal(products[0].index, 1);
  assert.equal(products[0].customAttributes[1].value, 'Zipper 1');
  assert.deepEqual(products[3].imageAssignment, generationContext.imageAssignments[3]);
  assert.deepEqual(products[0].keywords, ['safety vest']);
});

test('validateSimilarProductGeneration rejects incomplete or unsupported model output', () => {
  assert.throws(
    () => validateSimilarProductGeneration({ products: [] }, generationContext),
    /必须正好生成 4 个类似品/,
  );
  assert.throws(
    () => validateSimilarProductGeneration({
      products: [
        generatedProduct(1, { title: 'x'.repeat(129) }),
        generatedProduct(2), generatedProduct(3), generatedProduct(4),
      ],
    }, generationContext),
    /标题不能超过 128 个字符/,
  );
  assert.throws(
    () => validateSimilarProductGeneration({
      products: [
        generatedProduct(1, { faqItems: [{ question: 'Only one?', answer: 'Yes.' }] }),
        generatedProduct(2), generatedProduct(3), generatedProduct(4),
      ],
    }, generationContext),
    /FAQ 必须正好包含 5 组问答/,
  );
  assert.throws(
    () => validateSimilarProductGeneration({
      products: [
        generatedProduct(1, { keywords: ['not in the workbook'] }),
        generatedProduct(2), generatedProduct(3), generatedProduct(4),
      ],
    }, generationContext),
    /关键词不在已上传的词表中/,
  );
});
