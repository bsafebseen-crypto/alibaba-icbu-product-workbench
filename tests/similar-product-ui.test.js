import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAssignedFilesForUpload,
  normalizeAttributeRows,
  normalizeFaqRows,
  resolveAlibabaImages,
} from '../public/similar-product-ui.js';

test('normalizeAttributeRows trims rows and rejects duplicate names', () => {
  assert.deepEqual(normalizeAttributeRows([
    { name: ' Material ', value: ' Polyester ' },
    { name: 'Closure Style', value: 'Front Zipper' },
  ]), [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure Style', value: 'Front Zipper' },
  ]);

  assert.throws(() => normalizeAttributeRows([
    { name: 'Material', value: 'Polyester' },
    { name: 'material', value: 'Cotton' },
  ]), /自定义属性名不能重复/);
});

test('normalizeAttributeRows rejects half-filled rows', () => {
  assert.throws(
    () => normalizeAttributeRows([{ name: 'Material', value: '' }]),
    /属性名和值都必须填写/,
  );
});

test('normalizeFaqRows requires exactly five complete pairs', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    question: ` Question ${index + 1}? `,
    answer: ` Answer ${index + 1}. `,
  }));
  assert.deepEqual(normalizeFaqRows(rows)[0], {
    question: 'Question 1?',
    answer: 'Answer 1.',
  });
  assert.throws(() => normalizeFaqRows(rows.slice(0, 4)), /FAQ 必须正好填写 5 组/);
  assert.throws(
    () => normalizeFaqRows(rows.map((row, index) => index === 2 ? { ...row, answer: '' } : row)),
    /第 3 组 FAQ/,
  );
});

test('collectAssignedFilesForUpload returns each assigned local file once in stable order', () => {
  const mainFiles = Array.from({ length: 4 }, (_, index) => ({ name: `main-${index}.jpg` }));
  const auxiliaryFiles = Array.from({ length: 6 }, (_, index) => ({ name: `aux-${index}.jpg` }));
  const products = Array.from({ length: 4 }, (_, index) => ({
    imageAssignment: {
      mainImageIndex: index,
      auxiliaryImageIndexes: Array.from({ length: 5 }, (_unused, offset) => (index + offset) % 6),
    },
  }));

  const uploads = collectAssignedFilesForUpload(mainFiles, auxiliaryFiles, products);

  assert.deepEqual(uploads.map((upload) => upload.key), [
    'main:0', 'main:1', 'main:2', 'main:3',
    'auxiliary:0', 'auxiliary:1', 'auxiliary:2',
    'auxiliary:3', 'auxiliary:4', 'auxiliary:5',
  ]);
  assert.equal(uploads[0].file, mainFiles[0]);
  assert.equal(uploads[9].file, auxiliaryFiles[5]);
});

test('collectAssignedFilesForUpload refuses incomplete image assignments', () => {
  assert.throws(
    () => collectAssignedFilesForUpload([null, {}, {}, {}], Array(5).fill({}), [
      { imageAssignment: { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] } },
      { imageAssignment: { mainImageIndex: 1, auxiliaryImageIndexes: [0, 1, 2, 3, 4] } },
      { imageAssignment: { mainImageIndex: 2, auxiliaryImageIndexes: [0, 1, 2, 3, 4] } },
      { imageAssignment: { mainImageIndex: 3, auxiliaryImageIndexes: [0, 1, 2, 3, 4] } },
    ]),
    /类似品 1 缺少主图/,
  );
});

test('resolveAlibabaImages returns one main image followed by five assigned auxiliary images', () => {
  const product = {
    imageAssignment: { mainImageIndex: 2, auxiliaryImageIndexes: [4, 1, 3, 0, 2] },
  };
  const uploads = {
    'main:2': { fileId: 'm2', photobankUrl: 'https://img/m2.jpg' },
    'auxiliary:0': { fileId: 'a0', photobankUrl: 'https://img/a0.jpg' },
    'auxiliary:1': { fileId: 'a1', photobankUrl: 'https://img/a1.jpg' },
    'auxiliary:2': { fileId: 'a2', photobankUrl: 'https://img/a2.jpg' },
    'auxiliary:3': { fileId: 'a3', photobankUrl: 'https://img/a3.jpg' },
    'auxiliary:4': { fileId: 'a4', photobankUrl: 'https://img/a4.jpg' },
  };

  assert.deepEqual(resolveAlibabaImages(product, uploads, 0), [
    { fileId: 'm2', url: 'https://img/m2.jpg' },
    { fileId: 'a4', url: 'https://img/a4.jpg' },
    { fileId: 'a1', url: 'https://img/a1.jpg' },
    { fileId: 'a3', url: 'https://img/a3.jpg' },
    { fileId: 'a0', url: 'https://img/a0.jpg' },
    { fileId: 'a2', url: 'https://img/a2.jpg' },
  ]);
});

test('resolveAlibabaImages names the missing slot and product', () => {
  assert.throws(
    () => resolveAlibabaImages({
      imageAssignment: { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    }, { 'main:0': { fileId: 'm0', photobankUrl: 'https://img/m0.jpg' } }, 1),
    /类似品 2.*副图 1.*尚未上传/,
  );
});
