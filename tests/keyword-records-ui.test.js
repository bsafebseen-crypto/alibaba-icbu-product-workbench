import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  filterBlockedKeywords,
  filterInquiryKeywords,
  filterProducts,
  parseKeywordLines,
} from '../public/keyword-records.js';

test('parseKeywordLines trims, removes blanks, and deduplicates case-insensitively', () => {
  assert.deepEqual(parseKeywordLines(' vest \n\nVEST\nworkwear'), ['vest', 'workwear']);
});

test('keyword record filters match the user-visible searchable fields', () => {
  const products = [
    { product_id: '1601954851686' },
    { product_id: '1602847512398' },
  ];
  assert.deepEqual(filterProducts(products, '5485'), [products[0]]);

  const inquiry = [
    { keyword: 'reflective safety vest', note: 'priority' },
    { keyword: 'hi vis workwear', note: 'seasonal' },
  ];
  assert.deepEqual(filterInquiryKeywords(inquiry, 'PRIORITY'), [inquiry[0]]);

  const blocked = [
    { keyword: 'fashion vest', product_id: '1601954851686', note: '' },
    { keyword: 'dog vest', product_id: null, note: 'pet traffic' },
  ];
  assert.deepEqual(filterBlockedKeywords(blocked, 'vest', '1601954851686'), [blocked[0]]);
  assert.deepEqual(filterBlockedKeywords(blocked, 'PET', ''), [blocked[1]]);
});

test('workbench exposes the keyword records module and its two compact views', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-module="keyword-records"/);
  assert.match(html, /id="module-keyword-records"/);
  assert.match(html, /询盘词库/);
  assert.match(html, /直通车屏蔽词/);
  assert.match(html, /id="keyword-batch-dialog"/);
  assert.match(app, /initKeywordRecords/);
  assert.match(css, /\.keyword-record-layout/);
});
