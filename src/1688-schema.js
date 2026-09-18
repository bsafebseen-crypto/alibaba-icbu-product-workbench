import crypto from 'node:crypto';

const SUPPORTED_FIELD_TYPES = new Set([
  'input', 'cbuinput', 'textarea', 'number', 'inputnumber', 'cbunumber',
  'enumtext', 'enumtextlist', 'enumvalue', 'enumvaluelist', 'complexenumvalue',
  'treetext', 'treevalue', 'cbuprop', 'cbu_prop', 'catprop', 'saleprop',
  'image', 'detail', 'video', 'cbu_sku_table', 'skutable', 'pricerange',
  'processingpricerange', 'beginamount', 'processingbeginamount', 'unit',
  'sellunit', 'logistics', 'logisticssize', 'officiallogistics', 'sendaddress',
  'tradetemplate', 'buyerprotection', 'warrantyservice', 'block', 'layout',
  'globalmessage', 'import', 'relationoffer', 'processingrelationoffer',
  'processingprop', 'processingcustomway', 'processingsendcycle',
  'processingsupportsample', 'processingtakesampleprice', 'lightservice',
  'officiallogistics', 'ordergoods', 'takesample', 'iec', 'datePicker',
].map((value) => value.toLowerCase()));

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function parseJson(value, label) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 返回不是有效 JSON`);
  }
}

function businessData(response, label = '1688 Schema') {
  const result = response?.result || response;
  if (result?.success === false || result?.success === 'false') {
    const error = new Error(result.bizMsg || `${label}读取失败`);
    error.code = result.bizCode || '1688_SCHEMA_ERROR';
    throw error;
  }
  return parseJson(result?.bizData ?? result, label);
}

function normalizeField(field, fallbackPath) {
  const type = String(field.type || field.uiType || field.tag || '').trim();
  return {
    path: String(field.name || field.id || fallbackPath),
    label: String(field.label || field.name || field.id || fallbackPath),
    type,
    required: field.required === true,
    visible: field.visible !== false,
    readonly: field.readonly === true,
    minimum: field.minimum,
    maximum: field.maximum,
    includeMin: field.includeMin,
    includeMax: field.includeMax,
    minLength: field.minLength,
    maxLength: field.maxLength,
    minItems: field.minItems,
    maxItems: field.maxItems,
    pattern: field.pattern,
    dataSource: field.dataSource,
    raw: field,
  };
}

function collectFields(container, fields = [], seen = new Set()) {
  if (!container || typeof container !== 'object') return fields;
  const entries = Array.isArray(container)
    ? container.map((value, index) => [String(index), value])
    : Object.entries(container);
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    const isField = Boolean(value.type || value.uiType || value.tag)
      && Boolean(value.name || value.id || !/^\d+$/.test(key));
    if (isField) {
      const normalized = normalizeField(value, key);
      if (!seen.has(normalized.path)) {
        seen.add(normalized.path);
        fields.push(normalized);
      }
    }
    const nested = value.fields || value.children || value.column;
    if (nested) collectFields(nested, fields, seen);
  }
  return fields;
}

function createParsedSchema(raw) {
  const normalized = raw && typeof raw === 'object' ? raw : {};
  const fieldContainer = normalized.fields || normalized.schema?.fields || normalized.schema || {};
  return {
    raw: normalized,
    global: normalized.global || {},
    fields: collectFields(fieldContainer),
    hash: sha256(normalized),
  };
}

export function sceneFor1688Category(category, options = {}) {
  if (options.processing) return 'processing';
  const scenes = { 1: 'cbu', 2: 'industry', 3: 'popular' };
  const scene = scenes[Number(category?.categoryType)];
  if (!scene) throw new Error(`不支持的 1688 类目类型：${category?.categoryType ?? '未知'}`);
  return scene;
}

export function parse1688Schema(response) {
  return createParsedSchema(businessData(response));
}

function mergeArrays(base, update) {
  const keyed = [...base, ...update].every((item) => item && typeof item === 'object' && (item.name || item.id));
  if (!keyed) return structuredClone(update);
  const result = base.map((item) => structuredClone(item));
  for (const item of update) {
    const key = item.name || item.id;
    const index = result.findIndex((existing) => (existing.name || existing.id) === key);
    if (index === -1) result.push(structuredClone(item));
    else result[index] = deepMerge(result[index], item);
  }
  return result;
}

function deepMerge(base, update) {
  if (Array.isArray(base) && Array.isArray(update)) return mergeArrays(base, update);
  if (!base || !update || typeof base !== 'object' || typeof update !== 'object'
    || Array.isArray(base) || Array.isArray(update)) return structuredClone(update);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(update)) {
    result[key] = key in result ? deepMerge(result[key], value) : structuredClone(value);
  }
  return result;
}

export function merge1688SubSchema(baseSchema, response) {
  const update = businessData(response, '1688 子 Schema');
  return createParsedSchema(deepMerge(baseSchema.raw, update));
}

function getPathValue(target, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], target);
}

function isEmptyValue(value, field) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (field.type.toLowerCase() === 'image') return !Array.isArray(value.imageList) || value.imageList.length === 0;
  return false;
}

export function preflight1688Product(schema, formValues = {}) {
  const errors = [];
  const unsupported = [];
  for (const field of schema.fields) {
    if (!field.visible || field.readonly) continue;
    const type = field.type.toLowerCase();
    if (field.required && !SUPPORTED_FIELD_TYPES.has(type)) {
      unsupported.push({ path: field.path, label: field.label, type: field.type });
      continue;
    }
    const value = getPathValue(formValues, field.path);
    if (field.required && isEmptyValue(value, field)) {
      errors.push({ path: field.path, label: field.label, code: 'REQUIRED', message: `${field.label}为必填项` });
      continue;
    }
    if (isEmptyValue(value, field)) continue;
    if (field.maxLength !== undefined && String(value).length > Number(field.maxLength)) {
      errors.push({ path: field.path, label: field.label, code: 'MAX_LENGTH', message: `${field.label}不能超过 ${field.maxLength} 个字符` });
    }
    if (field.minLength !== undefined && String(value).length < Number(field.minLength)) {
      errors.push({ path: field.path, label: field.label, code: 'MIN_LENGTH', message: `${field.label}不能少于 ${field.minLength} 个字符` });
    }
    if (field.minimum !== undefined && Number(value) < Number(field.minimum)) {
      errors.push({ path: field.path, label: field.label, code: 'MINIMUM', message: `${field.label}不能小于 ${field.minimum}` });
    }
    if (field.maximum !== undefined && Number(value) > Number(field.maximum)) {
      errors.push({ path: field.path, label: field.label, code: 'MAXIMUM', message: `${field.label}不能大于 ${field.maximum}` });
    }
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(String(value))) {
          errors.push({ path: field.path, label: field.label, code: 'PATTERN', message: `${field.label}格式不正确` });
        }
      } catch {
        unsupported.push({ path: field.path, label: field.label, type: `${field.type}:invalid-pattern` });
      }
    }
  }
  return { valid: errors.length === 0 && unsupported.length === 0, errors, unsupported };
}

const SENSITIVE_KEY = /(?:access|refresh)?token|secret|authorization|authcode|imagebytes/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

function countImages(value) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countImages(item), 0);
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'imageList' && Array.isArray(item)) count += item.length;
    else count += countImages(item);
  }
  return count;
}

export function build1688PublishRequest({ schema, catId, scene, formValues }) {
  const safeFormValues = sanitize(formValues || {});
  const preflight = preflight1688Product(schema, safeFormValues);
  if (!String(safeFormValues.cargoNumber || '').trim()) {
    preflight.errors.push({
      path: 'cargoNumber',
      label: '货号',
      code: 'RECONCILIATION_REQUIRED',
      message: '货号为必填项，用于发布结果不确定时只读核验',
    });
    preflight.valid = false;
  }
  const dataBody = { global: structuredClone(schema.global), formValues: safeFormValues };
  const summary = {
    method: 'alibaba.new.product.add',
    catId: String(catId),
    scene: String(scene),
    fieldCount: Object.keys(safeFormValues).length,
    skuCount: Array.isArray(safeFormValues.skuTable) ? safeFormValues.skuTable.length : 0,
    imageCount: countImages(safeFormValues),
    schemaHash: schema.hash,
  };
  return {
    dataBody,
    summary,
    schemaHash: schema.hash,
    fingerprint: sha256({ catId: String(catId), scene: String(scene), dataBody }),
    preflight,
  };
}
