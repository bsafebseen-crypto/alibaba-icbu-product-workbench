import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateListing } from '../scripts/listing-tools.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function validListing() {
  const categories = ['材质', '功能', '结构', '外观', '场景', '人群', '工艺', '规格', '穿戴', '采购', '包装', '维护', '品牌', '季节', '适配'];
  const attributes = Array.from({ length: 5 }, (_, groupIndex) => ({
    group: groupIndex + 1,
    items: Array.from({ length: 3 }, (_, itemIndex) => {
      const index = groupIndex * 3 + itemIndex;
      return {
        name: `属性${index + 1}`,
        value: `独立属性值${index + 1}`,
        category: categories[index],
        dimension: `dimension-${index + 1}`,
        evidence: '图片可见',
      };
    }),
  }));

  return {
    productName: '荧光黄网眼反光背心',
    imageSource: 'C:/example/images',
    evidence: {
      confirmed: ['荧光黄色', '网眼结构', '灰色反光条'],
      inferred: ['适合低光环境提升可视性'],
      unknown: ['面料成分', '反光材料类型', '尺寸', '重量'],
    },
    keywords: {
      sourceFiles: ['反光背心主词表.xlsx'],
      used: ['反光背心', '安全马甲'],
      rejected: [{ keyword: '3M反光背心', reason: '图片和资料不能确认品牌材料' }],
    },
    titles: [
      { angle: '核心品类', title: '反光背心荧光黄网眼透气安全马甲道路施工环卫执勤夜间高可视警示工作服工厂批发团体采购', coreTerm: '反光背心' },
      { angle: '施工采购', title: '交通施工反光马甲荧光黄色网眼透气工地劳保环卫作业夜间警示安全背心工程采购批量供货', coreTerm: '反光马甲' },
      { angle: '穿着结构', title: '网眼反光安全背心荧光黄前开口魔术贴双横条高可视马甲户外作业交通值勤团队工作服', coreTerm: '安全背心' },
      { angle: '使用人群', title: '环卫反光背心荧光黄色网眼马甲道路养护物业保洁仓储装卸夜间作业高可视警示服装', coreTerm: '环卫反光背心' },
      { angle: '场景用途', title: '夜间作业反光马甲荧光黄透气网眼交通安全背心骑行户外应急高可视警示工作服批发', coreTerm: '反光马甲' },
    ],
    models: [
      { style: '英文类目缩写版', spu: 'YL-RV01', logic: '品牌缩写加反光背心英文缩写', skuExamples: ['YL-RV01-YE'] },
      { style: '拼音首字母版', spu: 'YL-FGBX01', logic: '品牌缩写加反光背心拼音首字母', skuExamples: ['YL-FGBX01-黄'] },
      { style: '核心属性结合版', spu: 'YL-MESH-RV01', logic: '品牌缩写加网眼与反光品类', skuExamples: ['YL-MESH-RV01-YE'] },
    ],
    attributes,
    estimates: {
      fabric: { label: '预估', value: '涤纶网眼布候选', basis: '图片呈网眼结构，成分待标签确认' },
      reflectiveMaterial: { label: '预估', value: '高亮灰色反光材料候选', basis: '图片可见灰色反光条，具体结构待检测' },
      size: { label: '建议写法', value: '尺码、衣长、胸围、肩宽，单位cm', basis: '需尺码表或实测数据' },
      weight: { label: '预估', value: '约100–180g/件', basis: '按同类网眼反光背心区间估算，需实物称重' },
    },
  };
}

test('accepts a complete five-title listing', () => {
  const result = validateListing(validListing());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.titleCounts.length, 5);
});

test('rejects a title over 60 code points', () => {
  const listing = validListing();
  listing.titles[0].title = '反'.repeat(61);
  const result = validateListing(listing);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('超过60字符')));
});

test('rejects duplicate attribute dimensions and values', () => {
  const listing = validListing();
  listing.attributes[1].items[0].dimension = listing.attributes[0].items[0].dimension;
  listing.attributes[1].items[0].value = listing.attributes[0].items[0].value;
  const result = validateListing(listing);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('属性维度重复')));
  assert.ok(result.errors.some((error) => error.includes('属性值重复')));
});

test('rejects SKU examples that do not extend their SPU', () => {
  const listing = validListing();
  listing.models[0].skuExamples = ['OTHER-YE'];
  const result = validateListing(listing);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('必须以SPU加连字符开头')));
});

test('requires estimates to state their evidence status and basis', () => {
  const listing = validListing();
  listing.estimates.weight = { label: '确定', value: '120g', basis: '' };
  const result = validateListing(listing);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('重量')));
});

test('rejects size chart fields used as custom product attributes', () => {
  const listing = validListing();
  listing.attributes[4].items = [
    { name: '尺码范围', value: 'S至4XL共七个尺码', category: '规格', dimension: 'size-range', evidence: '图片可见' },
    { name: '参考身高', value: '约160至200厘米', category: '适配', dimension: 'height-range', evidence: '图片可见' },
    { name: '参考体重', value: '约60至100公斤', category: '人群', dimension: 'weight-range', evidence: '图片可见' },
  ];
  const result = validateListing(listing);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('不能使用尺码表字段')));
});

test('runs the validate CLI when invoked with a relative script path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-tools-'));
  const inputPath = path.join(tempDir, 'listing.json');
  fs.writeFileSync(inputPath, JSON.stringify(validListing()), 'utf8');
  try {
    const result = spawnSync(process.execPath, ['scripts/listing-tools.mjs', 'validate', '--input', inputPath], {
      cwd: skillRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /"valid": true/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
