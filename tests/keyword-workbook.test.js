import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { parseKeywordWorkbook } from '../src/keyword-workbook.js';

test('parseKeywordWorkbook reads keyword columns across worksheets and deduplicates them', async () => {
  const workbook = new ExcelJS.Workbook();
  const main = workbook.addWorksheet('核心词');
  main.addRows([
    ['关键词', '搜索量'],
    ['Safety Vest', 3200],
    ['Reflective Vest', 2100],
  ]);
  const longTail = workbook.addWorksheet('长尾词');
  longTail.addRows([
    ['Keyword', 'Note'],
    ['safety vest', 'duplicate'],
    ['High Visibility Workwear', 'keep'],
  ]);
  const buffer = await workbook.xlsx.writeBuffer();

  const result = await parseKeywordWorkbook(buffer);

  assert.deepEqual(result.words, [
    'Safety Vest',
    'Reflective Vest',
    'High Visibility Workwear',
  ]);
  assert.deepEqual(result.sheets, ['核心词', '长尾词']);
});

test('parseKeywordWorkbook falls back to non-numeric text cells when no keyword header exists', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1').addRows([
    ['Traffic Safety Vest'],
    ['Warehouse Workwear'],
    [12345],
  ]);
  const buffer = await workbook.xlsx.writeBuffer();

  const result = await parseKeywordWorkbook(buffer);

  assert.deepEqual(result.words, ['Traffic Safety Vest', 'Warehouse Workwear']);
});
