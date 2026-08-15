function text(value) {
  return String(value ?? '').trim();
}

export function normalizeAttributeRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
    name: text(row?.name),
    value: text(row?.value),
  }));
  const names = new Set();
  for (const row of normalized) {
    if (!row.name || !row.value) throw new Error('属性名和值都必须填写');
    const key = row.name.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`自定义属性名不能重复：${row.name}`);
    names.add(key);
  }
  return normalized;
}

export function normalizeFaqRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 5) throw new Error('FAQ 必须正好填写 5 组');
  return rows.map((row, index) => {
    const question = text(row?.question);
    const answer = text(row?.answer);
    if (!question || !answer) throw new Error(`第 ${index + 1} 组 FAQ 的问题和答案都必须填写`);
    return { question, answer };
  });
}

export function collectAssignedFilesForUpload(mainFiles, auxiliaryFiles, products) {
  if (!Array.isArray(products) || products.length !== 4) {
    throw new Error('必须先准备好 4 个类似品的图片组合');
  }

  const mainIndexes = new Set();
  const auxiliaryIndexes = new Set();
  products.forEach((product, productIndex) => {
    const assignment = product?.imageAssignment;
    const mainIndex = Number(assignment?.mainImageIndex);
    if (!Number.isInteger(mainIndex) || !mainFiles?.[mainIndex]) {
      throw new Error(`类似品 ${productIndex + 1} 缺少主图`);
    }
    mainIndexes.add(mainIndex);

    const indexes = assignment?.auxiliaryImageIndexes;
    if (!Array.isArray(indexes) || indexes.length !== 5 || new Set(indexes).size !== 5) {
      throw new Error(`类似品 ${productIndex + 1} 必须分配 5 张不同的副图`);
    }
    indexes.forEach((index) => {
      if (!Number.isInteger(index) || !auxiliaryFiles?.[index]) {
        throw new Error(`类似品 ${productIndex + 1} 的副图分配无效`);
      }
      auxiliaryIndexes.add(index);
    });
  });

  return [
    ...[...mainIndexes].sort((a, b) => a - b)
      .map((index) => ({ key: `main:${index}`, file: mainFiles[index] })),
    ...[...auxiliaryIndexes].sort((a, b) => a - b)
      .map((index) => ({ key: `auxiliary:${index}`, file: auxiliaryFiles[index] })),
  ];
}

export function resolveAlibabaImages(product, photobankUploads, productIndex = 0) {
  const assignment = product?.imageAssignment;
  const auxiliary = assignment?.auxiliaryImageIndexes;
  if (!Number.isInteger(assignment?.mainImageIndex)
    || !Array.isArray(auxiliary)
    || auxiliary.length !== 5
    || new Set(auxiliary).size !== 5) {
    throw new Error(`类似品 ${productIndex + 1} 的图片分配不完整`);
  }

  const slots = [
    { key: `main:${assignment.mainImageIndex}`, label: '主图' },
    ...auxiliary.map((index, offset) => ({
      key: `auxiliary:${index}`,
      label: `副图 ${offset + 1}`,
    })),
  ];
  return slots.map(({ key, label }) => {
    const upload = photobankUploads?.[key];
    const fileId = text(upload?.fileId);
    const url = text(upload?.photobankUrl);
    if (!fileId || !url) {
      throw new Error(`类似品 ${productIndex + 1} 的${label}尚未上传完整`);
    }
    return { fileId, url };
  });
}

function input(className, value, placeholder) {
  const element = document.createElement('input');
  element.className = className;
  element.type = 'text';
  element.value = value || '';
  element.placeholder = placeholder;
  return element;
}

export function renderAttributeRows(container, rows, changes = []) {
  const changeByName = new Map((Array.isArray(changes) ? changes : [])
    .map((change) => [text(change?.name).toLocaleLowerCase(), change]));
  container.replaceChildren();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'attribute-row';
    wrapper.dataset.index = String(index);
    const change = changeByName.get(text(row?.name).toLocaleLowerCase());
    if (change) wrapper.dataset.change = change.operation;
    wrapper.append(
      input('attribute-name', row?.name, '属性名'),
      input('attribute-value', row?.value, '属性值'),
    );
    const controls = document.createElement('div');
    controls.className = 'row-controls';
    controls.innerHTML = [
      '<button type="button" data-row-action="up" aria-label="上移">↑</button>',
      '<button type="button" data-row-action="down" aria-label="下移">↓</button>',
      '<button type="button" data-row-action="delete" aria-label="删除">×</button>',
    ].join('');
    wrapper.append(controls);
    if (change) {
      const badge = document.createElement('small');
      badge.className = 'change-badge';
      badge.textContent = change.operation === 'add'
        ? 'AI 新增'
        : change.operation === 'delete' ? 'AI 删除' : `原值：${change.before || '—'}`;
      wrapper.append(badge);
    }
    container.append(wrapper);
  });
}

export function readAttributeRows(container) {
  return normalizeAttributeRows([...container.querySelectorAll('.attribute-row')].map((row) => ({
    name: row.querySelector('.attribute-name')?.value,
    value: row.querySelector('.attribute-value')?.value,
  })));
}

export function renderFaqRows(container, rows = []) {
  const normalizedRows = Array.from({ length: 5 }, (_, index) => rows[index] || {});
  container.replaceChildren();
  normalizedRows.forEach((row, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'faq-row';
    const number = document.createElement('span');
    number.className = 'faq-number';
    number.textContent = String(index + 1).padStart(2, '0');
    wrapper.append(
      number,
      input('faq-question', row?.question, 'Question'),
      input('faq-answer', row?.answer, 'Answer'),
    );
    container.append(wrapper);
  });
}

export function readFaqRows(container) {
  return normalizeFaqRows([...container.querySelectorAll('.faq-row')].map((row) => ({
    question: row.querySelector('.faq-question')?.value,
    answer: row.querySelector('.faq-answer')?.value,
  })));
}

export function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error || new Error('图片读取失败')));
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file, options = {}) {
  const maxEdge = Number(options.maxEdge || 1536);
  const quality = Number(options.quality || 0.82);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('图片压缩失败')),
    'image/jpeg',
    quality,
  ));
  return fileToDataUrl(blob);
}
