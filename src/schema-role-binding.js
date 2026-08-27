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

function normalizeBinding(binding = {}) {
  const fieldId = String(binding.fieldId || '').trim();
  const structureType = String(binding.structureType || '').trim();
  const carrierPath = Array.isArray(binding.carrierPath)
    ? binding.carrierPath.map((part) => String(part))
    : [];
  if (!fieldId || structureType !== 'single-text' || !carrierPath.length) {
    throw new Error('卖点字段绑定无效');
  }
  if (carrierPath.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error('卖点字段路径无效');
  }
  return { fieldId, structureType, carrierPath };
}

function locateCarrier(tree, binding) {
  const normalized = normalizeBinding(binding);
  const fields = collectFields(tree).filter((field) => String(field?.['@_id'] || '') === normalized.fieldId);
  if (fields.length !== 1) throw new Error('卖点字段不存在或不唯一');
  let node = fields[0];
  for (const part of normalized.carrierPath.slice(0, -1)) {
    node = node?.[part];
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('卖点字段结构已经变化');
    }
  }
  const key = normalized.carrierPath.at(-1);
  if (!Object.hasOwn(node, key) || typeof node[key] !== 'string') {
    throw new Error('卖点字段结构已经变化');
  }
  return { binding: normalized, node, key };
}

export function resolveSellingPointBinding(schemaTree, binding) {
  return locateCarrier(schemaTree, binding).binding;
}

export function readBoundSellingPoints(schemaTree, binding) {
  const carrier = locateCarrier(schemaTree, binding);
  return carrier.node[carrier.key].trim();
}

export function writeBoundSellingPoints(schemaTree, binding, value) {
  const carrier = locateCarrier(schemaTree, binding);
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error('主题卖点不能为空');
  carrier.node[carrier.key] = normalized;
}
