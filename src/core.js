function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value ?? '').trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseWordList(text, fileName = '') {
  const content = String(text ?? '').replace(/^\uFEFF/, '');
  if (/\.csv$/i.test(fileName)) {
    const rows = parseCsvRows(content);
    const dataRows = rows.length > 1 ? rows.slice(1) : rows;
    return uniqueNonEmpty(dataRows.flat());
  }

  return uniqueNonEmpty(content.split(/[\n\r,;\t]+/));
}

function emptyProduct(index) {
  return {
    index,
    kind: index === 1 ? 'base' : 'similar',
    title: '',
    sellingPoints: '',
    faq: '',
    keywords: [],
  };
}

export function createManualProducts() {
  return Array.from({ length: 5 }, (_, index) => emptyProduct(index + 1));
}

export function createSimilarProductsFromTemplate(sourceProductId) {
  const normalizedId = String(sourceProductId || '').trim();
  if (!/^\d+$/.test(normalizedId)) throw new Error('主产品 ID 必须是数字');
  return Array.from({ length: 4 }, (_, offset) => ({
    ...emptyProduct(offset + 1),
    kind: 'similar',
    sourceProductId: normalizedId,
  }));
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return uniqueNonEmpty(value);
  return uniqueNonEmpty(String(value ?? '').split(/[\n,;]+/));
}

export function validateGeneratedProducts(value) {
  const products = value?.products;
  if (!Array.isArray(products) || products.length !== 5) {
    throw new Error('必须正好生成 5 个商品版本');
  }

  return products.map((product, offset) => {
    const index = offset + 1;
    return {
      index,
      kind: index === 1 ? 'base' : 'similar',
      title: String(product?.title ?? '').trim(),
      sellingPoints: normalizeStringList(product?.sellingPoints).join('\n'),
      faq: String(product?.faq ?? '').trim(),
      keywords: normalizeStringList(product?.keywords),
    };
  });
}

export function sanitizeTaskForStorage(value) {
  if (typeof value === 'string' && /^data:image\//i.test(value)) return undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeTaskForStorage).filter((child) => child !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const blockedKeys = new Set([
    'apikey',
    'appsecret',
    'accesstoken',
    'refreshtoken',
    'imagedataurls',
    'dataurl',
  ]);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blockedKeys.has(key.toLocaleLowerCase().replace(/[^a-z]/g, '')))
      .map(([key, child]) => [key, sanitizeTaskForStorage(child)]),
  );
}
