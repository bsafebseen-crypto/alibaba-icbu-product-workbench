import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EMPTY_DATA = Object.freeze({
  products: [],
  inquiry_keywords: [],
  blocked_keywords: [],
});

function storeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeProductId(value, optional = false) {
  const normalized = String(value ?? '').trim();
  if (!normalized && optional) return null;
  if (!normalized) throw storeError('Product ID 不能为空');
  if (!/^\d+$/.test(normalized)) throw storeError('Product ID 只能包含数字');
  return normalized;
}

function normalizeKeyword(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw storeError('关键词不能为空');
  return normalized;
}

function normalizeNote(value) {
  return String(value ?? '').trim();
}

function keywordKey(value) {
  return value.toLocaleLowerCase();
}

function parseKeywordLines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function validateShape(value) {
  if (!value || !Array.isArray(value.products)
    || !Array.isArray(value.inquiry_keywords)
    || !Array.isArray(value.blocked_keywords)) {
    throw storeError('关键词记录文件格式无效', 422);
  }
  return value;
}

export function createKeywordRecordStore(rootDir, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const randomUUID = deps.randomUUID ?? crypto.randomUUID;
  const filePath = path.join(path.resolve(rootDir), 'data', 'keyword-records.json');
  let mutationQueue = Promise.resolve();

  async function readFileData() {
    try {
      return validateShape(JSON.parse(await readFile(filePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return cloneData(EMPTY_DATA);
      if (error instanceof SyntaxError) throw storeError('关键词记录文件格式无效', 422);
      throw error;
    }
  }

  async function writeData(data) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
    return cloneData(data);
  }

  function mutate(updater) {
    const operation = mutationQueue.then(async () => {
      const data = await readFileData();
      return updater(data);
    });
    mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async function readAll() {
    await mutationQueue;
    return cloneData(await readFileData());
  }

  function ensureProduct(data, productId) {
    if (!data.products.some((item) => item.product_id === productId)) {
      throw storeError('Product ID 不存在', 404);
    }
  }

  function addProduct(input = {}) {
    return mutate(async (data) => {
      const productId = normalizeProductId(input.product_id);
      if (data.products.some((item) => item.product_id === productId)) {
        throw storeError('Product ID 已存在', 409);
      }
      data.products.push({ id: randomUUID(), product_id: productId, created_at: now().toISOString() });
      return writeData(data);
    });
  }

  function removeProduct(id) {
    return mutate(async (data) => {
      const index = data.products.findIndex((item) => item.id === id);
      if (index < 0) throw storeError('Product ID 记录不存在', 404);
      const [{ product_id: productId }] = data.products.splice(index, 1);
      data.inquiry_keywords = data.inquiry_keywords.filter((item) => item.product_id !== productId);
      return writeData(data);
    });
  }

  function addInquiryKeyword(input = {}) {
    return mutate(async (data) => {
      const productId = normalizeProductId(input.product_id);
      const keyword = normalizeKeyword(input.keyword);
      ensureProduct(data, productId);
      if (data.inquiry_keywords.some((item) => item.product_id === productId
        && keywordKey(item.keyword) === keywordKey(keyword))) {
        throw storeError('该 Product ID 下关键词已存在', 409);
      }
      data.inquiry_keywords.push({
        id: randomUUID(), product_id: productId, keyword,
        note: normalizeNote(input.note), created_at: now().toISOString(),
      });
      return writeData(data);
    });
  }

  function updateInquiryKeyword(id, input = {}) {
    return mutate(async (data) => {
      const record = data.inquiry_keywords.find((item) => item.id === id);
      if (!record) throw storeError('询盘词记录不存在', 404);
      const keyword = normalizeKeyword(input.keyword);
      if (data.inquiry_keywords.some((item) => item.id !== id
        && item.product_id === record.product_id
        && keywordKey(item.keyword) === keywordKey(keyword))) {
        throw storeError('该 Product ID 下关键词已存在', 409);
      }
      record.keyword = keyword;
      record.note = normalizeNote(input.note);
      return writeData(data);
    });
  }

  function removeInquiryKeyword(id) {
    return mutate(async (data) => {
      const index = data.inquiry_keywords.findIndex((item) => item.id === id);
      if (index < 0) throw storeError('询盘词记录不存在', 404);
      data.inquiry_keywords.splice(index, 1);
      return writeData(data);
    });
  }

  function batchAddInquiryKeywords(input = {}) {
    return mutate(async (data) => {
      const productId = normalizeProductId(input.product_id);
      ensureProduct(data, productId);
      const existing = new Set(data.inquiry_keywords
        .filter((item) => item.product_id === productId)
        .map((item) => keywordKey(item.keyword)));
      let added = 0;
      let skipped = 0;
      for (const keyword of parseKeywordLines(input.keywords)) {
        const key = keywordKey(keyword);
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        existing.add(key);
        added += 1;
        data.inquiry_keywords.push({
          id: randomUUID(), product_id: productId, keyword,
          note: normalizeNote(input.note), created_at: now().toISOString(),
        });
      }
      const persisted = await writeData(data);
      return { data: persisted, added, skipped };
    });
  }

  function blockedKey(productId, keyword) {
    return `${productId ?? ''}\u0000${keywordKey(keyword)}`;
  }

  function addBlockedKeyword(input = {}) {
    return mutate(async (data) => {
      const productId = normalizeProductId(input.product_id, true);
      const keyword = normalizeKeyword(input.keyword);
      const key = blockedKey(productId, keyword);
      if (data.blocked_keywords.some((item) => blockedKey(item.product_id, item.keyword) === key)) {
        throw storeError('该屏蔽词已存在', 409);
      }
      data.blocked_keywords.push({
        id: randomUUID(), product_id: productId, keyword,
        note: normalizeNote(input.note), created_at: now().toISOString(),
      });
      return writeData(data);
    });
  }

  function updateBlockedKeyword(id, input = {}) {
    return mutate(async (data) => {
      const record = data.blocked_keywords.find((item) => item.id === id);
      if (!record) throw storeError('屏蔽词记录不存在', 404);
      const productId = normalizeProductId(input.product_id, true);
      const keyword = normalizeKeyword(input.keyword);
      const key = blockedKey(productId, keyword);
      if (data.blocked_keywords.some((item) => item.id !== id
        && blockedKey(item.product_id, item.keyword) === key)) {
        throw storeError('该屏蔽词已存在', 409);
      }
      record.product_id = productId;
      record.keyword = keyword;
      record.note = normalizeNote(input.note);
      return writeData(data);
    });
  }

  function removeBlockedKeyword(id) {
    return mutate(async (data) => {
      const index = data.blocked_keywords.findIndex((item) => item.id === id);
      if (index < 0) throw storeError('屏蔽词记录不存在', 404);
      data.blocked_keywords.splice(index, 1);
      return writeData(data);
    });
  }

  function batchAddBlockedKeywords(input = {}) {
    return mutate(async (data) => {
      const productId = normalizeProductId(input.product_id, true);
      const existing = new Set(data.blocked_keywords.map((item) => blockedKey(item.product_id, item.keyword)));
      let added = 0;
      let skipped = 0;
      for (const keyword of parseKeywordLines(input.keywords)) {
        const key = blockedKey(productId, keyword);
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        existing.add(key);
        added += 1;
        data.blocked_keywords.push({
          id: randomUUID(), product_id: productId, keyword,
          note: normalizeNote(input.note), created_at: now().toISOString(),
        });
      }
      const persisted = await writeData(data);
      return { data: persisted, added, skipped };
    });
  }

  return {
    readAll,
    addProduct,
    removeProduct,
    addInquiryKeyword,
    updateInquiryKeyword,
    removeInquiryKeyword,
    batchAddInquiryKeywords,
    addBlockedKeyword,
    updateBlockedKeyword,
    removeBlockedKeyword,
    batchAddBlockedKeywords,
  };
}
