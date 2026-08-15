import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createManualProducts,
  createSimilarProductsFromTemplate,
  parseWordList,
  sanitizeTaskForStorage,
  validateGeneratedProducts,
} from '../src/core.js';

test('parseWordList parses and deduplicates TXT words', () => {
  assert.deepEqual(
    parseWordList('safety vest\nreflective vest, safety vest\nworkwear', 'words.txt'),
    ['safety vest', 'reflective vest', 'workwear'],
  );
});

test('parseWordList reads common CSV cells and ignores the header', () => {
  const csv = 'keyword,category\n"safety vest",PPE\nreflective vest,workwear';
  assert.deepEqual(parseWordList(csv, 'words.csv'), [
    'safety vest',
    'PPE',
    'reflective vest',
    'workwear',
  ]);
});

test('createManualProducts creates one base product and four similar products', () => {
  const products = createManualProducts();
  assert.equal(products.length, 5);
  assert.equal(products[0].kind, 'base');
  assert.deepEqual(products.slice(1).map((product) => product.kind), [
    'similar',
    'similar',
    'similar',
    'similar',
  ]);
});

test('createSimilarProductsFromTemplate creates four editable copies linked to one source ID', () => {
  const products = createSimilarProductsFromTemplate('1601915922577');
  assert.equal(products.length, 4);
  assert.deepEqual(products.map((product) => product.index), [1, 2, 3, 4]);
  assert.equal(products.every((product) => product.kind === 'similar'), true);
  assert.equal(products.every((product) => product.sourceProductId === '1601915922577'), true);
  assert.equal(products.every((product) => product.faq === ''), true);
});

test('validateGeneratedProducts rejects a result that does not contain five products', () => {
  assert.throws(
    () => validateGeneratedProducts({ products: [{ title: 'Only one' }] }),
    /必须正好生成 5 个商品版本/,
  );
});

test('validateGeneratedProducts normalizes five products', () => {
  const products = Array.from({ length: 5 }, (_, index) => ({
    title: `Title ${index + 1}`,
    sellingPoints: [`Point ${index + 1}`, 'Shared point'],
    keywords: ['safety vest', `keyword ${index + 1}`],
  }));

  const result = validateGeneratedProducts({ products });
  assert.equal(result.length, 5);
  assert.equal(result[0].index, 1);
  assert.equal(result[0].kind, 'base');
  assert.equal(result[4].kind, 'similar');
  assert.equal(result[0].sellingPoints, 'Point 1\nShared point');
});

test('sanitizeTaskForStorage removes API keys recursively', () => {
  const stored = sanitizeTaskForStorage({
    apiKey: 'secret-top-level',
    generation: {
      provider: 'custom',
      apiKey: 'secret-nested',
      baseUrl: 'https://example.com/v1',
    },
    products: createManualProducts(),
  });

  assert.equal(JSON.stringify(stored).includes('secret'), false);
  assert.equal(stored.generation.baseUrl, 'https://example.com/v1');
});

test('sanitizeTaskForStorage removes Alibaba credentials and transient image data', () => {
  const stored = sanitizeTaskForStorage({
    appSecret: 'ali-secret',
    accessToken: 'ali-token',
    refreshToken: 'ali-refresh',
    source: {
      mainImageNames: ['main-1.jpg'],
      imageDataUrls: [{ name: 'main-1.jpg', dataUrl: 'data:image/jpeg;base64,AAA' }],
    },
  });
  const raw = JSON.stringify(stored);
  assert.doesNotMatch(raw, /ali-secret|ali-token|ali-refresh|data:image|base64,AAA/);
  assert.deepEqual(stored.source.mainImageNames, ['main-1.jpg']);
});
