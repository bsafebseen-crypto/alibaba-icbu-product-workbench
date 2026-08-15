function normalizedText(value) {
  return String(value ?? '').trim();
}

function normalizedKey(value) {
  return normalizedText(value).toLocaleLowerCase();
}

function normalizedAttribute(attribute) {
  const name = normalizedText(attribute?.name);
  const value = normalizedText(attribute?.value);
  if (!name || !value) throw new Error('自定义属性名和值不能为空');
  return { name, value };
}

function assertUniqueAttributeNames(attributes) {
  const names = new Set();
  for (const attribute of attributes) {
    const key = normalizedKey(attribute.name);
    if (names.has(key)) throw new Error(`自定义属性名重复：${attribute.name}`);
    names.add(key);
  }
}

export function assignProductImages(mainImages, auxiliaryImages) {
  if (!Array.isArray(mainImages) || mainImages.length !== 4) {
    throw new Error('需要正好 4 张主图');
  }
  if (!Array.isArray(auxiliaryImages) || auxiliaryImages.length < 5) {
    throw new Error('至少需要 5 张副图');
  }

  return mainImages.map((_image, productIndex) => ({
    mainImageIndex: productIndex,
    auxiliaryImageIndexes: Array.from(
      { length: 5 },
      (_unused, offset) => (productIndex + offset) % auxiliaryImages.length,
    ),
  }));
}

export function applyAttributeChanges(sourceAttributes, changes) {
  const attributes = (Array.isArray(sourceAttributes) ? sourceAttributes : [])
    .map(normalizedAttribute);
  assertUniqueAttributeNames(attributes);

  const requestedChanges = Array.isArray(changes) ? changes : [];
  if (requestedChanges.length > 5) throw new Error('每套最多只能改动 5 个自定义属性');

  const normalizedChanges = [];
  for (const requested of requestedChanges) {
    const operation = normalizedText(requested?.operation).toLocaleLowerCase();
    const name = normalizedText(requested?.name);
    const key = normalizedKey(name);
    if (!['add', 'update', 'delete'].includes(operation)) {
      throw new Error('自定义属性操作只能是 add、update 或 delete');
    }
    if (!name) throw new Error('自定义属性名和值不能为空');

    const existingIndex = attributes.findIndex((attribute) => normalizedKey(attribute.name) === key);
    if (operation === 'add') {
      if (existingIndex >= 0) throw new Error(`自定义属性名重复：${name}`);
      const after = normalizedText(requested?.after);
      if (!after) throw new Error('自定义属性名和值不能为空');
      attributes.push({ name, value: after });
      normalizedChanges.push({ operation, name, before: '', after });
      continue;
    }

    if (existingIndex < 0) {
      throw new Error(`找不到要${operation === 'update' ? '修改' : '删除'}的自定义属性：${name}`);
    }
    const existing = attributes[existingIndex];
    if (operation === 'delete') {
      attributes.splice(existingIndex, 1);
      normalizedChanges.push({ operation, name: existing.name, before: existing.value, after: '' });
      continue;
    }

    const after = normalizedText(requested?.after);
    if (!after) throw new Error('自定义属性名和值不能为空');
    attributes[existingIndex] = { name: existing.name, value: after };
    normalizedChanges.push({
      operation,
      name: existing.name,
      before: existing.value,
      after,
    });
  }

  assertUniqueAttributeNames(attributes);
  return { attributes, changes: normalizedChanges };
}

function normalizeFaqItems(value) {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error('FAQ 必须正好包含 5 组问答');
  }
  return value.map((item) => {
    const question = normalizedText(item?.question);
    const answer = normalizedText(item?.answer);
    if (!question || !answer) throw new Error('FAQ 的问题和答案不能为空');
    return { question, answer };
  });
}

function normalizeKeywords(value, allowedKeywords) {
  const allowed = new Map(
    (Array.isArray(allowedKeywords) ? allowedKeywords : [])
      .map(normalizedText)
      .filter(Boolean)
      .map((keyword) => [normalizedKey(keyword), keyword]),
  );
  const seen = new Set();
  const keywords = [];
  for (const rawKeyword of Array.isArray(value) ? value : []) {
    const key = normalizedKey(rawKeyword);
    if (!key || seen.has(key)) continue;
    if (!allowed.has(key)) throw new Error(`关键词不在已上传的词表中：${normalizedText(rawKeyword)}`);
    seen.add(key);
    keywords.push(allowed.get(key));
  }
  return keywords;
}

export function validateSimilarProductGeneration(value, context = {}) {
  if (!Array.isArray(value?.products) || value.products.length !== 4) {
    throw new Error('必须正好生成 4 个类似品');
  }
  if (!Array.isArray(context.imageAssignments) || context.imageAssignments.length !== 4) {
    throw new Error('缺少 4 个类似品的图片分配');
  }

  return value.products.map((product, offset) => {
    const title = normalizedText(product?.title);
    if (!title) throw new Error(`类似品 ${offset + 1} 的标题不能为空`);
    if (title.length > 128) throw new Error('标题不能超过 128 个字符');
    const sellingPoints = normalizedText(product?.sellingPoints);
    if (!sellingPoints) throw new Error(`类似品 ${offset + 1} 的主题卖点不能为空`);
    const faqItems = normalizeFaqItems(product?.faqItems);
    const applied = applyAttributeChanges(context.sourceAttributes, product?.attributeChanges);
    const keywords = normalizeKeywords(product?.keywords, context.allowedKeywords);

    return {
      index: offset + 1,
      kind: 'similar',
      title,
      sellingPoints,
      faqItems,
      faq: faqItems.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join('\n'),
      customAttributes: applied.attributes,
      attributeChanges: applied.changes,
      keywords,
      imageAssignment: structuredClone(context.imageAssignments[offset]),
    };
  });
}
