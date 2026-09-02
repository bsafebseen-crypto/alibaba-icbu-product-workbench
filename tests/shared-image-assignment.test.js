import test from 'node:test';
import assert from 'node:assert/strict';

import { assignSharedProductImages } from '../src/shared-image-assignment.js';

function image(character, fileName = `${character}.jpg`) {
  return {
    sha256: character.repeat(64),
    fileName,
    size: 100,
    mimeType: 'image/jpeg',
  };
}

const variants = ['plan-2', 'plan-3', 'plan-4', 'plan-5'].map((planId) => ({ planId }));
const mainImages = ['0', '1', '2', '3'].map((value) => image(value, `main-${value}.jpg`));
const fixedImages = [image('e', '2.jpg'), image('f', '证书主图.jpg')];

test('assignSharedProductImages rotates a three-image marketing pool in stable order', () => {
  const result = assignSharedProductImages({
    variants,
    mainImages,
    marketingImages: [image('a'), image('b'), image('c')],
    fixedImages,
  });

  assert.deepEqual(result.map((assignment) => ({
    planId: assignment.planId,
    names: assignment.files.map((item) => item.fileName),
  })), [
    { planId: 'plan-2', names: ['main-0.jpg', '证书主图.jpg', 'a.jpg', 'b.jpg', 'c.jpg', '2.jpg'] },
    { planId: 'plan-3', names: ['main-1.jpg', '证书主图.jpg', 'b.jpg', 'c.jpg', 'a.jpg', '2.jpg'] },
    { planId: 'plan-4', names: ['main-2.jpg', '证书主图.jpg', 'c.jpg', 'a.jpg', 'b.jpg', '2.jpg'] },
    { planId: 'plan-5', names: ['main-3.jpg', '证书主图.jpg', 'a.jpg', 'b.jpg', 'c.jpg', '2.jpg'] },
  ]);
});

test('assignSharedProductImages uses different three-image windows from a larger pool', () => {
  const result = assignSharedProductImages({
    variants,
    mainImages,
    marketingImages: [image('a'), image('b'), image('c'), image('d')],
    fixedImages,
  });

  assert.deepEqual(result[1].files.map((item) => item.fileName), [
    'main-1.jpg', '证书主图.jpg', 'b.jpg', 'c.jpg', 'd.jpg', '2.jpg',
  ]);
  assert.deepEqual(result[3].files.map((item) => item.fileName), [
    'main-3.jpg', '证书主图.jpg', 'd.jpg', 'a.jpg', 'b.jpg', '2.jpg',
  ]);
});

test('assignSharedProductImages rejects incomplete inputs and duplicate content per product', () => {
  assert.throws(() => assignSharedProductImages({
    variants,
    mainImages: mainImages.slice(0, 3),
    marketingImages: [image('a'), image('b'), image('c')],
    fixedImages,
  }), /必须选择 4 张主图/);
  assert.throws(() => assignSharedProductImages({
    variants,
    mainImages,
    marketingImages: [image('a'), image('b')],
    fixedImages,
  }), /至少选择 3 张营销副图/);
  assert.throws(() => assignSharedProductImages({
    variants,
    mainImages,
    marketingImages: [image('a'), image('b'), image('c')],
    fixedImages: [image('e'), image('e', 'duplicate.jpg')],
  }), /plan-2 的 6 张图片不能包含重复内容/);
});
