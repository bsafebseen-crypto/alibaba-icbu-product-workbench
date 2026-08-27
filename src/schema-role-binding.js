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

function carrierPaths(value, currentPath = [], results = []) {
  if (!value || typeof value !== 'object') return results;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'rules') continue;
    const nextPath = [...currentPath, key];
    if (['value', '@_value', '#text'].includes(key) && typeof child === 'string') {
      results.push({ path: nextPath, value: child });
      continue;
    }
    if (Array.isArray(child)) {
      child.forEach((item, index) => carrierPaths(item, [...nextPath, String(index)], results));
    } else {
      carrierPaths(child, nextPath, results);
    }
  }
  return results;
}

export function summarizeSellingPointCandidates(schemaXml) {
  const xml = String(schemaXml || '');
  if (XMLValidator.validate(xml) !== true) throw new Error('Schema XML 无效');
  const fields = collectFields(parser.parse(xml));
  return fields.flatMap((field) => {
    const fieldId = String(field?.['@_id'] || '').trim();
    const fieldName = String(field?.['@_name'] || '').trim();
    const identity = `${fieldId} ${fieldName}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
    if (!/(sellingpoints?|productsummary|themesellingpoints|textdesc|卖点)/i.test(identity)) return [];
    const carriers = carrierPaths(field);
    if (!carriers.length) return [];
    return [{
      fieldId,
      fieldName,
      structureType: carriers.length === 1 ? 'single-text' : 'ambiguous',
      carrierPaths: carriers.map((carrier) => carrier.path),
      nonEmpty: carriers.some((carrier) => carrier.value.trim()),
    }];
  });
}

export function validateSellingPointBinding(schemaXml, binding) {
  const xml = String(schemaXml || '');
  if (XMLValidator.validate(xml) !== true) throw new Error('Schema XML 无效');
  return resolveSellingPointBinding(parser.parse(xml), binding);
}

function bindingFile(rootDir) {
  return path.join(path.resolve(rootDir), 'data', 'alibaba-schema-bindings.json');
}

function normalizeContext(context = {}) {
  const normalized = {
    categoryId: String(context.categoryId || '').trim(),
    language: String(context.language || '').trim(),
    version: String(context.version || '').trim(),
  };
  if (!normalized.categoryId || !normalized.language || !normalized.version) {
    throw new Error('卖点字段上下文不完整');
  }
  return normalized;
}

async function readBindings(rootDir) {
  try {
    const value = JSON.parse(await readFile(bindingFile(rootDir), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function saveSellingPointBinding(rootDir, input = {}) {
  const context = normalizeContext(input);
  const binding = normalizeBinding(input);
  const safe = { ...binding, ...context };
  const key = `${context.categoryId}:${context.language}:${context.version}`;
  const values = await readBindings(rootDir);
  values[key] = safe;
  const filePath = bindingFile(rootDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
  return safe;
}

export async function readSellingPointBinding(rootDir, context = {}) {
  const normalized = normalizeContext(context);
  const values = await readBindings(rootDir);
  return values[`${normalized.categoryId}:${normalized.language}:${normalized.version}`] || null;
}
import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
});
