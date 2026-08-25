const START_MARKER = '<!-- alibaba-listing-batch:start -->';
const END_MARKER = '<!-- alibaba-listing-batch:end -->';

export const OBSIDIAN_LISTING_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_ROOT = 'C:\\obsidian\\obsidian\\国际站发品';

export function extractListingPayload(markdown) {
  if (typeof markdown !== 'string') throw new Error('Markdown 内容必须是字符串');

  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER, start + START_MARKER.length);
  if (start < 0 || end < 0) throw new Error('缺少阿里发品机器数据块');
  if (
    markdown.indexOf(START_MARKER, start + START_MARKER.length) >= 0
    || markdown.indexOf(END_MARKER, end + END_MARKER.length) >= 0
  ) {
    throw new Error('Markdown 只能包含一个阿里发品机器数据块');
  }

  const block = markdown.slice(start + START_MARKER.length, end).trim();
  const match = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/.exec(block);
  if (!match) throw new Error('阿里发品机器数据块必须使用 json 代码块');

  return JSON.parse(match[1]);
}

function requireRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 不能为空`);
  return value.trim();
}

function normalizeFaq(faq, path) {
  requireRecord(faq, path);
  return {
    question: requireString(faq.question, `${path}.question`),
    answer: requireString(faq.answer, `${path}.answer`),
  };
}

function normalizeAttribute(attribute, path) {
  requireRecord(attribute, path);
  return {
    name: requireString(attribute.name, `${path}.name`),
    value: requireString(attribute.value, `${path}.value`),
  };
}

function normalizePlan(plan, index) {
  const path = `plans[${index}]`;
  requireRecord(plan, path);
  if (!Array.isArray(plan.faqs) || plan.faqs.length !== 5) {
    throw new Error(`${path}.faqs 必须正好包含 5 条`);
  }
  if (!Array.isArray(plan.customAttributes) || plan.customAttributes.length !== 10) {
    throw new Error(`${path}.customAttributes 必须正好包含 10 条`);
  }

  const customAttributes = plan.customAttributes.map((attribute, attributeIndex) => (
    normalizeAttribute(attribute, `${path}.customAttributes[${attributeIndex}]`)
  ));
  const attributeNames = customAttributes.map(({ name }) => name.toLocaleLowerCase());
  if (new Set(attributeNames).size !== attributeNames.length) {
    throw new Error(`${path}.customAttributes 属性名不能重复`);
  }

  return {
    id: requireString(plan.id, `${path}.id`),
    title: requireString(plan.title, `${path}.title`),
    sellingPoints: requireString(plan.sellingPoints, `${path}.sellingPoints`),
    faqs: plan.faqs.map((faq, faqIndex) => normalizeFaq(faq, `${path}.faqs[${faqIndex}]`)),
    customAttributes,
  };
}

export function validateListingBatch(payload, source = {}) {
  requireRecord(payload, '批次');
  if (payload.schemaVersion !== OBSIDIAN_LISTING_SCHEMA_VERSION) {
    throw new Error(`不支持 schemaVersion ${String(payload.schemaVersion)}`);
  }
  if (!Array.isArray(payload.plans) || payload.plans.length !== 5) {
    throw new Error('plans 必须正好包含 5 套方案');
  }

  const plans = payload.plans.map(normalizePlan);
  const planIds = plans.map(({ id }) => id.toLocaleLowerCase());
  if (new Set(planIds).size !== planIds.length) throw new Error('方案 id 不能重复');

  return {
    schemaVersion: OBSIDIAN_LISTING_SCHEMA_VERSION,
    batchId: requireString(payload.batchId, 'batchId'),
    batchName: requireString(payload.batchName, 'batchName'),
    plans,
    source: { ...source },
  };
}
