import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

import {
  readBoundSellingPoints,
  writeBoundSellingPoints,
} from './schema-role-binding.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  suppressBooleanAttributes: false,
  suppressEmptyNode: true,
});

const ROLE_PATTERNS = {
  title: /^(subject|productname|producttitle|title)$/,
  productSummary: /^(productsummary|sellingpoints|themesellingpoints|textdesc)$/,
  faq: /^(productfaq|faq|companyfaqdesc)$/,
  customAttributes: /^(customattributes|customattribute|customprops|custommoreproperty)$/,
  images: /^scimages$/,
};

function normalizeIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectFields(value, fields = []) {
  if (!value || typeof value !== 'object') return fields;
  if (Object.hasOwn(value, 'field')) fields.push(...asArray(value.field));
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) collectFields(item, fields);
  }
  return fields;
}

function findValue(value) {
  if (!value || typeof value !== 'object') return '';
  if (Object.hasOwn(value, 'value') && typeof value.value !== 'object') {
    return String(value.value ?? '');
  }
  const identity = normalizeIdentity(value['@_name']);
  if (Object.hasOwn(value, '@_value') && !identity.endsWith('rule')) {
    return String(value['@_value'] ?? '');
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'rules') continue;
    for (const item of asArray(child)) {
      const found = findValue(item);
      if (found !== '') return found;
    }
  }
  return '';
}

function findValueCarrier(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'value') && typeof value.value !== 'object') {
    return { node: value, key: 'value' };
  }
  const identity = normalizeIdentity(value['@_name']);
  if (Object.hasOwn(value, '@_value') && !identity.endsWith('rule')) {
    return { node: value, key: '@_value' };
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'rules') continue;
    for (const item of asArray(child)) {
      const found = findValueCarrier(item);
      if (found) return found;
    }
  }
  return null;
}

function collectFaqParts(value, parts = []) {
  if (!value || typeof value !== 'object') return parts;
  const identity = normalizeIdentity(value['@_id'] || value['@_name']);
  const carrier = findValueCarrier(value);
  if ((identity.includes('question') || identity.includes('answer')) && carrier) {
    parts.push({
      identity,
      value: String(carrier.node[carrier.key] ?? ''),
      node: carrier.node,
      key: carrier.key,
    });
    return parts;
  }
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) collectFaqParts(item, parts);
  }
  return parts;
}

function readFaqItems(field) {
  const parts = collectFaqParts(field);
  const questions = parts.filter((part) => part.identity.includes('question'));
  const answers = parts.filter((part) => part.identity.includes('answer'));
  return questions.map((question, index) => ({
    question: question.value,
    answer: answers[index]?.value || '',
  }));
}

function collectComplexRows(value, rows = []) {
  if (!value || typeof value !== 'object') return rows;
  if (Object.hasOwn(value, 'complex-value')) rows.push(...asArray(value['complex-value']));
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) collectComplexRows(item, rows);
  }
  return rows;
}

function collectAttributeParts(value, parts = []) {
  if (!value || typeof value !== 'object') return parts;
  const identity = normalizeIdentity(value['@_id'] || value['@_name']);
  const kind = /^(attributename|propertyname|customattributename|propname)\d*$/.test(identity)
    ? 'name'
    : /^(attributevalue|propertyvalue|customattributevalue|valuename)\d*$/.test(identity)
      ? 'value'
      : '';
  const carrier = findValueCarrier(value);
  if (kind && carrier) {
    parts.push({
      kind,
      value: String(carrier.node[carrier.key] ?? ''),
      node: carrier.node,
      key: carrier.key,
    });
    return parts;
  }
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) collectAttributeParts(item, parts);
  }
  return parts;
}

function readCustomAttributes(field) {
  const renderedRows = collectFields(field)
    .filter((row) => /^custommoreproperty\d+$/.test(normalizeIdentity(row?.['@_id'])));
  if (renderedRows.length) {
    return renderedRows.flatMap((row) => {
      const parts = collectAttributeParts(row);
      const name = parts.find((part) => part.kind === 'name')?.value?.trim();
      const value = parts.find((part) => part.kind === 'value')?.value?.trim();
      return name && value ? [{ name, value }] : [];
    });
  }
  return collectComplexRows(field).flatMap((row) => {
    const parts = collectAttributeParts(row);
    const name = parts.find((part) => part.kind === 'name')?.value?.trim();
    const value = parts.find((part) => part.kind === 'value')?.value?.trim();
    return name && value ? [{ name, value }] : [];
  });
}

function findComplexValuesContainer(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'complex-value')) return value;
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) {
      const found = findComplexValuesContainer(item);
      if (found) return found;
    }
  }
  return null;
}

function renumberIdentity(node, index) {
  for (const attribute of ['@_id', '@_name']) {
    if (typeof node?.[attribute] !== 'string') continue;
    node[attribute] = node[attribute].replace(/\d+$/, String(index + 1));
  }
}

export function assertCustomAttributeValueLengths(attributes, planId = '') {
  // The formal API enforces this limit even when the rendered Schema omits it.
  attributes.forEach((attribute, index) => {
    const value = String(attribute?.value || '').trim();
    if (value.length > 70) {
      throw Object.assign(new Error(`${planId ? `${planId} ` : ''}自定义属性 ${index + 1}「${attribute.name}」值为 ${value.length} 个字符，超过阿里允许的 70 个字符；请缩短后重新生成完整预览`), { status: 400 });
    }
  });
}

function writeCustomAttributes(field, attributes, planId) {
  if (!Array.isArray(attributes) || !attributes.length) {
    throw new Error('自定义属性至少需要保留 1 项');
  }
  const normalized = attributes.map((attribute) => {
    const name = String(attribute?.name || '').trim();
    const value = String(attribute?.value || '').trim();
    if (!name || !value) throw new Error('自定义属性名和值不能为空');
    return { name, value };
  });
  assertCustomAttributeValueLengths(normalized, planId);
  const renderedContainer = field?.['complex-value'];
  const renderedRows = asArray(renderedContainer?.field)
    .filter((row) => /^custommoreproperty\d+$/.test(normalizeIdentity(row?.['@_id'])));
  if (renderedContainer && renderedRows.length) {
    const templateRow = renderedRows[0];
    renderedContainer.field = normalized.map(({ name, value }, index) => {
      const row = structuredClone(templateRow);
      const parts = collectAttributeParts(row);
      const namePart = parts.find((part) => part.kind === 'name');
      const valuePart = parts.find((part) => part.kind === 'value');
      if (!namePart || !valuePart) throw new Error('Schema 缺少可安全替换的自定义属性结构');
      namePart.node[namePart.key] = name;
      valuePart.node[valuePart.key] = value;
      row['@_id'] = `customMoreProperty_${index}`;
      return row;
    });
    return;
  }

  const container = findComplexValuesContainer(field);
  const templateRow = collectComplexRows(field)[0];
  if (!container || !templateRow) throw new Error('Schema 缺少可安全替换的自定义属性结构');

  container['complex-value'] = normalized.map(({ name, value }, index) => {
    const row = structuredClone(templateRow);
    const parts = collectAttributeParts(row);
    const namePart = parts.find((part) => part.kind === 'name');
    const valuePart = parts.find((part) => part.kind === 'value');
    if (!namePart || !valuePart) throw new Error('Schema 缺少可安全替换的自定义属性结构');
    namePart.node[namePart.key] = name;
    valuePart.node[valuePart.key] = value;
    renumberIdentity(namePart.node, index);
    renumberIdentity(valuePart.node, index);
    return row;
  });
}

function isImageRow(field) {
  return /^scimages\d+$/.test(normalizeIdentity(field?.['@_id'] || field?.['@_name']));
}

function findImageValueCarrier(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'value')) {
    if (value.value && typeof value.value === 'object' && Object.hasOwn(value.value, '#text')) {
      return { node: value.value, key: '#text', metadataNode: value.value };
    }
    if (typeof value.value !== 'object') {
      return { node: value, key: 'value', metadataNode: value };
    }
  }
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) {
      const found = findImageValueCarrier(item);
      if (found) return found;
    }
  }
  return null;
}

function imageRows(field) {
  return collectFields(field).filter(isImageRow);
}

function findSharedImageContainer(value) {
  if (!value || typeof value !== 'object') return null;
  const rows = asArray(value.field).filter(isImageRow);
  if (rows.length) return { container: value, rows };
  for (const child of Object.values(value)) {
    for (const item of asArray(child)) {
      const found = findSharedImageContainer(item);
      if (found) return found;
    }
  }
  return null;
}

function readAlibabaImages(field) {
  return imageRows(field).flatMap((row) => {
    const carrier = findImageValueCarrier(row);
    const fileId = String(carrier?.metadataNode?.['@_fileId'] || '').trim();
    const url = String(carrier?.node?.[carrier?.key] || '').trim();
    return fileId && url ? [{ fileId, url }] : [];
  });
}

function writeAlibabaImages(field, images) {
  if (!Array.isArray(images) || images.length !== 6) {
    throw new Error('商品图片必须正好包含 1 张主图和 5 张副图');
  }
  const normalized = images.map((image) => ({
    fileId: String(image?.fileId || '').trim(),
    url: String(image?.url || '').trim(),
  }));
  if (normalized.some((image) => !image.fileId || !image.url)) {
    throw new Error('每张商品图片都必须包含 fileId 和 URL');
  }

  const wrappers = asArray(field?.['complex-value']);
  const imageWrapperIndexes = wrappers
    .map((wrapper, index) => ({ index, rows: asArray(wrapper?.field).filter(isImageRow) }))
    .filter(({ rows }) => rows.length === 1);
  if (!field) throw new Error('Schema 缺少可安全替换的图片结构');
  if (!imageWrapperIndexes.length) {
    const shared = findSharedImageContainer(field);
    if (!shared) throw new Error('Schema 缺少可安全替换的图片结构');
    const generatedRows = normalized.map((image, index) => {
      const row = structuredClone(shared.rows[0]);
      const carrier = findImageValueCarrier(row);
      if (!carrier) throw new Error('Schema 缺少可安全替换的图片结构');
      row['@_id'] = `scImages_${index}`;
      carrier.node[carrier.key] = image.url;
      carrier.metadataNode['@_fileId'] = image.fileId;
      return row;
    });
    let inserted = false;
    shared.container.field = asArray(shared.container.field).flatMap((row) => {
      if (!isImageRow(row)) return [row];
      if (inserted) return [];
      inserted = true;
      return generatedRows;
    });
    return;
  }

  const templateWrapper = imageWrapperIndexes[0] && wrappers[imageWrapperIndexes[0].index];
  const firstImageIndex = imageWrapperIndexes[0].index;
  const imageIndexSet = new Set(imageWrapperIndexes.map(({ index }) => index));
  const generated = normalized.map((image, index) => {
    const wrapper = structuredClone(templateWrapper);
    const row = asArray(wrapper.field).find(isImageRow);
    const carrier = findImageValueCarrier(row);
    if (!row || !carrier) throw new Error('Schema 缺少可安全替换的图片结构');
    row['@_id'] = `scImages_${index}`;
    carrier.node[carrier.key] = image.url;
    carrier.metadataNode['@_fileId'] = image.fileId;
    return wrapper;
  });
  field['complex-value'] = wrappers.flatMap((wrapper, index) => {
    if (index === firstImageIndex) return generated;
    return imageIndexSet.has(index) ? [] : [wrapper];
  });
}

function parseFaqText(value) {
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];
  for (let index = 0; index < lines.length; index += 2) {
    const question = lines[index]?.match(/^Q\s*:\s*(.+)$/i)?.[1]?.trim();
    const answer = lines[index + 1]?.match(/^A\s*:\s*(.+)$/i)?.[1]?.trim();
    if (!question || !answer) throw new Error('FAQ 必须按 Q 和 A 成对填写');
    items.push({ question, answer });
  }
  if (!items.length) throw new Error('FAQ 必须按 Q 和 A 成对填写');
  return items;
}

function matchRole(field) {
  const identities = [field?.['@_id'], field?.['@_name']].map(normalizeIdentity);
  return Object.entries(ROLE_PATTERNS)
    .find(([, pattern]) => identities.some((identity) => pattern.test(identity)))?.[0] || '';
}

export function analyzeProductSchema(schemaXml, options = {}) {
  const xml = String(schemaXml || '');
  if (XMLValidator.validate(xml) !== true) throw new Error('Schema XML 无效');
  const tree = parser.parse(xml);
  const fields = collectFields(tree);
  const recognized = {
    title: null,
    productSummary: null,
    faq: null,
    customAttributes: null,
    images: null,
  };

  for (const field of fields) {
    const role = matchRole(field);
    if (!role || recognized[role]) continue;
    const fieldId = String(field['@_id'] || '');
    if (role === 'faq') recognized[role] = { fieldId, items: readFaqItems(field) };
    else if (role === 'customAttributes') {
      recognized[role] = { fieldId, items: readCustomAttributes(field) };
    } else if (role === 'images') recognized[role] = { fieldId, items: readAlibabaImages(field) };
    else if (role === 'productSummary' && normalizeIdentity(fieldId) === 'textdesc') {
      recognized[role] = { fieldId, value: findValue(field), confirmed: false };
    } else recognized[role] = { fieldId, value: findValue(field) };
  }

  if (options.sellingPointBinding) {
    recognized.productSummary = {
      fieldId: String(options.sellingPointBinding.fieldId || ''),
      value: readBoundSellingPoints(tree, options.sellingPointBinding),
      confirmed: true,
    };
  }

  const warnings = [];
  if (!recognized.title) warnings.push('未识别标题字段');
  if (!recognized.productSummary) warnings.push('未识别主题卖点字段');
  if (!recognized.faq) warnings.push('未识别 FAQ 字段');
  if (!recognized.customAttributes) warnings.push('未识别自定义属性字段');

  return { fieldCount: fields.length, recognized, warnings };
}

export function createProductPreview(schemaXml, variant = {}) {
  const title = String(variant.title || '').trim();
  if (title.length > 128) throw new Error('标题不能超过 128 个字符');

  const xml = String(schemaXml || '');
  const analysis = analyzeProductSchema(xml, {
    sellingPointBinding: variant.sellingPointBinding,
  });
  if (analysis.warnings.length) throw new Error(`Schema 缺少可安全替换的字段：${analysis.warnings.join('、')}`);
  if (analysis.recognized.productSummary?.confirmed === false) {
    throw new Error('卖点字段尚未校准，不能生成商品预览');
  }

  const tree = parser.parse(xml);
  const fields = collectFields(tree);
  const roleFields = Object.fromEntries(
    fields.map((field) => [matchRole(field), field]).filter(([role]) => role),
  );
  const titleCarrier = findValueCarrier(roleFields.title);
  const summaryCarrier = variant.sellingPointBinding
    ? null
    : findValueCarrier(roleFields.productSummary);
  if (!titleCarrier || (!summaryCarrier && !variant.sellingPointBinding)) {
    throw new Error('Schema 缺少可安全替换的字段');
  }

  titleCarrier.node[titleCarrier.key] = title;
  if (variant.sellingPointBinding) {
    writeBoundSellingPoints(tree, variant.sellingPointBinding, variant.sellingPoints);
    if (readBoundSellingPoints(tree, variant.sellingPointBinding) !== String(variant.sellingPoints || '').trim()) {
      throw new Error('卖点字段写入后校验失败');
    }
  } else {
    summaryCarrier.node[summaryCarrier.key] = String(variant.sellingPoints || '').trim();
  }

  const faqParts = collectFaqParts(roleFields.faq);
  const questionParts = faqParts.filter((part) => part.identity.includes('question'));
  const answerParts = faqParts.filter((part) => part.identity.includes('answer'));
  const hasStructuredFaq = Array.isArray(variant.faqItems);
  const faqItems = hasStructuredFaq
    ? variant.faqItems.map((item) => ({
      question: String(item?.question || '').trim(),
      answer: String(item?.answer || '').trim(),
    }))
    : parseFaqText(variant.faq);
  if (hasStructuredFaq && (
    faqItems.length !== 5
    || faqItems.some((item) => !item.question || !item.answer)
  )) {
    throw new Error('FAQ 必须正好包含前 5 组问答');
  }
  if (hasStructuredFaq && (questionParts.length < 5 || answerParts.length < 5)) {
    throw new Error('主产品 FAQ 少于 5 组，无法只替换前 5 组');
  }
  if (!hasStructuredFaq && (
    questionParts.length !== faqItems.length
    || answerParts.length !== faqItems.length
  )) {
    throw new Error(`FAQ 数量必须与主产品一致（${questionParts.length} 组）`);
  }
  faqItems.forEach((item, index) => {
    questionParts[index].node[questionParts[index].key] = item.question;
    answerParts[index].node[answerParts[index].key] = item.answer;
  });

  const changedFields = ['title', 'productSummary', 'faq'];
  if (Array.isArray(variant.customAttributes)) {
    writeCustomAttributes(roleFields.customAttributes, variant.customAttributes, variant.planId);
    changedFields.push('customAttributes');
  }
  if (variant.alibabaImages !== undefined) {
    writeAlibabaImages(roleFields.images, variant.alibabaImages);
    changedFields.push('images');
  }

  return {
    previewXml: builder.build(tree),
    changedFields,
    warnings: [],
  };
}

function maskMutableSchemaNodes(value) {
  if (Array.isArray(value)) return value.map(maskMutableSchemaNodes);
  if (!value || typeof value !== 'object') return value;
  const role = matchRole(value);
  if (role) return { __mutableRole: role };
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, maskMutableSchemaNodes(child)]),
  );
}

function firstSchemaDifference(left, right, path = '$') {
  if (Object.is(left, right)) return '';
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const fieldId = left[index]?.['@_id'] || right[index]?.['@_id'];
      const childPath = fieldId ? `${path}[id=${fieldId}]` : `${path}[${index}]`;
      const difference = firstSchemaDifference(left[index], right[index], childPath);
      if (difference) return difference;
    }
    return '';
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    const leftLength = typeof left === 'string' ? `:${left.length}` : '';
    const rightLength = typeof right === 'string' ? `:${right.length}` : '';
    return `${path}（${typeof left}${leftLength} -> ${typeof right}${rightLength}）`;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  for (const key of keys) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return `${path}.${key}`;
    const difference = firstSchemaDifference(left[key], right[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return '';
}

export function assertOnlyMutableSchemaRolesChanged(sourceXml, previewXml) {
  const sourceTree = parser.parse(builder.build(parser.parse(String(sourceXml || ''))));
  const previewTree = parser.parse(String(previewXml || ''));
  const sourceProtected = maskMutableSchemaNodes(sourceTree);
  const previewProtected = maskMutableSchemaNodes(previewTree);
  if (JSON.stringify(sourceProtected) !== JSON.stringify(previewProtected)) {
    throw new Error(
      `预览修改了允许范围之外的 Schema 字段：${firstSchemaDifference(sourceProtected, previewProtected)}`,
    );
  }
  return true;
}
