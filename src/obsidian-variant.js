import crypto from 'node:crypto';

import {
  assertOnlyMutableSchemaRolesChanged,
  createProductPreview,
} from './schema-template.js';

function requireNonEmpty(value, path) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${path} 不能为空`);
  return normalized;
}

function normalizeVariant(plan) {
  const title = requireNonEmpty(plan.title, '标题');
  if (title.length > 128) throw new Error('标题不能超过 128 个字符');
  if (!Array.isArray(plan.faqs) || plan.faqs.length !== 5) {
    throw new Error('每套方案必须正好包含 5 条 FAQ');
  }
  if (!Array.isArray(plan.customAttributes) || plan.customAttributes.length !== 10) {
    throw new Error('每套方案必须正好包含 10 条自定义属性');
  }
  const faqItems = plan.faqs.map((faq, index) => ({
    question: requireNonEmpty(faq?.question, `FAQ ${index + 1} 问题`),
    answer: requireNonEmpty(faq?.answer, `FAQ ${index + 1} 答案`),
  }));
  const customAttributes = plan.customAttributes.map((attribute, index) => ({
    name: requireNonEmpty(attribute?.name, `自定义属性 ${index + 1} 名称`),
    value: requireNonEmpty(attribute?.value, `自定义属性 ${index + 1} 值`),
  }));
  const names = customAttributes.map(({ name }) => name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error('自定义属性名称不能重复');
  return {
    planId: requireNonEmpty(plan.id, '方案 ID'),
    title,
    sellingPoints: requireNonEmpty(plan.sellingPoints, '主题卖点'),
    faqItems,
    customAttributes,
  };
}

export function createObsidianVariants(batch, basePlanId) {
  if (!Array.isArray(batch?.plans) || batch.plans.length !== 5) {
    throw new Error('Obsidian 批次必须正好包含 5 套方案');
  }
  if (!batch.plans.some((plan) => plan.id === basePlanId)) {
    throw new Error('请选择批次中的一个母商品方案');
  }
  return batch.plans.filter((plan) => plan.id !== basePlanId).map(normalizeVariant);
}

export function createStrictProductPreview(schemaXml, variant) {
  if (!Array.isArray(variant?.alibabaImages) || variant.alibabaImages.length !== 6) {
    throw new Error('每个类似品必须正好包含 1 张主图和 5 张副图');
  }
  if (variant.alibabaImages.some((image) => !String(image?.fileId || '').trim() || !String(image?.url || '').trim())) {
    throw new Error('每张图片都必须包含图片银行 fileId 和 URL');
  }
  const normalized = normalizeVariant({
    id: variant.planId,
    title: variant.title,
    sellingPoints: variant.sellingPoints,
    faqs: variant.faqItems,
    customAttributes: variant.customAttributes,
  });
  const preview = createProductPreview(schemaXml, {
    ...normalized,
    alibabaImages: variant.alibabaImages,
  });
  assertOnlyMutableSchemaRolesChanged(schemaXml, preview.previewXml);
  return {
    ...preview,
    fingerprint: crypto.createHash('sha256').update(preview.previewXml, 'utf8').digest('hex'),
    preservedFields: {
      standardAttributes: true,
      sku: true,
      price: true,
      certificates: true,
      logistics: true,
      details: true,
      unrecognizedFields: true,
    },
  };
}
