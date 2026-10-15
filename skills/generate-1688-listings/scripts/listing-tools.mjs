import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_EVIDENCE = new Set(['图片可见', '用户提供', '实测', '预估', '建议写法']);
const ESTIMATE_LABELS = {
  fabric: '面料材质',
  reflectiveMaterial: '反光材料',
  size: '尺寸',
  weight: '重量',
};

function codePointLength(value) {
  return [...String(value ?? '').trim()].length;
}

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.map(normalized).filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateListing(listing) {
  const errors = [];
  const warnings = [];
  const titleCounts = [];

  if (!listing || typeof listing !== 'object') {
    return { valid: false, errors: ['输入必须是JSON对象'], warnings, titleCounts };
  }

  for (const field of ['productName', 'imageSource']) {
    if (!String(listing[field] ?? '').trim()) errors.push(`缺少${field}`);
  }

  for (const field of ['confirmed', 'inferred', 'unknown']) {
    if (!Array.isArray(listing.evidence?.[field])) errors.push(`evidence.${field}必须是数组`);
  }

  if (!Array.isArray(listing.titles) || listing.titles.length !== 5) {
    errors.push('标题必须刚好5条');
  } else {
    listing.titles.forEach((item, index) => {
      const title = String(item?.title ?? '').trim();
      const count = codePointLength(title);
      titleCounts.push({ index: index + 1, count });
      if (!title) errors.push(`标题${index + 1}不能为空`);
      if (count > 60) errors.push(`标题${index + 1}超过60字符：${count}`);
      if (count > 0 && count < 50) warnings.push(`标题${index + 1}仅${count}字符，补充新的真实采购维度后再定稿`);
      if (!String(item?.angle ?? '').trim()) errors.push(`标题${index + 1}缺少采购搜索角度`);
      const coreTerm = String(item?.coreTerm ?? '').trim();
      if (!coreTerm) {
        errors.push(`标题${index + 1}缺少核心识别词`);
      } else {
        const position = title.indexOf(coreTerm);
        if (position < 0 || position >= Math.ceil(title.length / 2)) {
          errors.push(`标题${index + 1}的核心识别词未出现在前半部分`);
        }
      }
      if (/(最好|第一|顶级|百分百|绝对|全球领先|永久|零风险)/u.test(title)) {
        errors.push(`标题${index + 1}含夸张或绝对化词语`);
      }
    });
    if (duplicateValues(listing.titles.map((item) => item?.title)).length) errors.push('标题内容重复');
    if (duplicateValues(listing.titles.map((item) => item?.angle)).length) errors.push('标题采购搜索角度重复');
  }

  if (!Array.isArray(listing.models) || listing.models.length !== 3) {
    errors.push('SPU方案必须刚好3套');
  } else {
    const expectedStyles = new Set(['英文类目缩写版', '拼音首字母版', '核心属性结合版']);
    for (const [index, model] of listing.models.entries()) {
      if (!expectedStyles.has(model?.style)) errors.push(`SPU方案${index + 1}命名风格无效`);
      const spu = String(model?.spu ?? '').trim();
      if (!spu || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/u.test(spu)) errors.push(`SPU方案${index + 1}格式无效`);
      if (!String(model?.logic ?? '').trim()) errors.push(`SPU方案${index + 1}缺少命名逻辑`);
      if (!Array.isArray(model?.skuExamples) || model.skuExamples.length === 0) {
        errors.push(`SPU方案${index + 1}缺少SKU示例`);
      } else {
        for (const sku of model.skuExamples) {
          if (!String(sku).startsWith(`${spu}-`)) errors.push(`SPU方案${index + 1}的SKU必须以SPU加连字符开头`);
        }
      }
    }
    if (duplicateValues(listing.models.map((model) => model?.spu)).length) errors.push('SPU编码重复');
    if (duplicateValues(listing.models.map((model) => model?.style)).length) errors.push('SPU命名风格重复');
  }

  const allAttributes = [];
  if (!Array.isArray(listing.attributes) || listing.attributes.length !== 5) {
    errors.push('自定义属性必须刚好5组');
  } else {
    listing.attributes.forEach((group, groupIndex) => {
      if (!Array.isArray(group?.items) || group.items.length !== 3) {
        errors.push(`属性第${groupIndex + 1}组必须刚好3项`);
        return;
      }
      allAttributes.push(...group.items);
      if (duplicateValues(group.items.map((item) => item?.category)).length) {
        errors.push(`属性第${groupIndex + 1}组必须混合3个不同角度`);
      }
    });
  }
  for (const [index, item] of allAttributes.entries()) {
    if (!String(item?.name ?? '').trim() || codePointLength(item.name) > 10) errors.push(`属性${index + 1}名称必须为1至10字符`);
    if (!String(item?.value ?? '').trim() || codePointLength(item.value) > 50) errors.push(`属性${index + 1}值必须为1至50字符`);
    if (!String(item?.category ?? '').trim()) errors.push(`属性${index + 1}缺少角度类别`);
    if (!String(item?.dimension ?? '').trim()) errors.push(`属性${index + 1}缺少唯一语义维度`);
    if (!ALLOWED_EVIDENCE.has(item?.evidence)) errors.push(`属性${index + 1}证据状态无效`);
    const attributeIdentity = `${item?.name ?? ''} ${item?.category ?? ''} ${item?.dimension ?? ''}`;
    if (/(尺码|身高|体重|重量|胸围|衣长|肩宽|袖长|腰围|臀围|size|height|weight|measurement)/iu.test(attributeIdentity)) {
      errors.push(`属性${index + 1}不能使用尺码表字段，应改为产品外观、结构、工艺、功能或场景属性`);
    }
  }
  if (duplicateValues(allAttributes.map((item) => item?.name)).length) errors.push('属性名重复');
  if (duplicateValues(allAttributes.map((item) => item?.value)).length) errors.push('属性值重复');
  if (duplicateValues(allAttributes.map((item) => item?.dimension)).length) errors.push('属性维度重复');

  for (const [field, label] of Object.entries(ESTIMATE_LABELS)) {
    const estimate = listing.estimates?.[field];
    if (!estimate || !ALLOWED_EVIDENCE.has(estimate.label) || !String(estimate.value ?? '').trim() || !String(estimate.basis ?? '').trim()) {
      errors.push(`${label}必须包含有效状态、内容和依据`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, titleCounts };
}

function usage() {
  console.error('用法: node listing-tools.mjs validate --input <listing.json> [--output <result.json>]');
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command !== 'validate') {
    usage();
    process.exitCode = 2;
  } else {
    const inputPath = option('--input');
    if (!inputPath) {
      usage();
      process.exitCode = 2;
    } else {
      const listing = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
      const result = validateListing(listing);
      const outputPath = option('--output');
      if (outputPath) fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.valid || result.warnings.length) process.exitCode = 1;
    }
  }
}
