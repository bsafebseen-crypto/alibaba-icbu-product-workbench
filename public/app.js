import {
  collectAssignedFilesForUpload,
  compressImage,
  fileToDataUrl,
  renderAttributeRows,
  renderFaqRows,
  resolveAlibabaImages,
} from './similar-product-ui.js';
import {
  buildProductRows,
  filterProductRows,
  sortProductRows,
  summarizeDashboard,
} from './product-pool.js';
import { initObsidianPublishing } from './obsidian-publishing.js';
import { init1688Publishing } from './1688-publishing.js';
import { initKeywordRecords } from './keyword-records.js';
import { initLocalServiceConnection } from './local-service.js';

const providerPresets = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  custom: '',
};

const providerNames = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  siliconflow: '硅基流动',
  custom: '自定义接口',
};

const storageKeys = {
  aiProfile: 'icbu-workbench-ai-profile',
  persistentKey: 'icbu-workbench-api-key',
  sessionKey: 'icbu-workbench-session-api-key',
  alibabaProfile: 'icbu-workbench-alibaba-profile',
  alibabaPersistentSecret: 'icbu-workbench-alibaba-secret',
  alibabaPersistentToken: 'icbu-workbench-alibaba-token',
  alibabaPersistentRefreshToken: 'icbu-workbench-alibaba-refresh-token',
  alibabaSessionSecret: 'icbu-workbench-session-alibaba-secret',
  alibabaSessionToken: 'icbu-workbench-session-alibaba-token',
  alibabaSessionRefreshToken: 'icbu-workbench-session-alibaba-refresh-token',
};

const state = {
  products: [],
  currentIndex: 0,
  mainImageFiles: Array(4).fill(null),
  mainImageUrls: Array(4).fill(''),
  auxiliaryImageFiles: [],
  auxiliaryImageUrls: [],
  wordFileName: '',
  words: [],
  mode: 'manual',
  sourceTemplate: null,
  alibabaRefreshToken: '',
  photobankUploads: {},
  taskSummaries: [],
  productRows: [],
  productPoolQuery: '',
  productPoolStage: 'all',
  productPoolSort: 'updatedAt:desc',
  productPoolPage: 1,
  drawerTask: null,
  drawerProduct: null,
  drawerRow: null,
  drawerTab: 'overview',
  drawerTrigger: null,
  currentTaskSaved: false,
};

const ids = [
  'provider', 'base-url', 'api-key', 'remember-key', 'model', 'test-ai', 'save-ai',
  'toggle-key', 'ai-status', 'active-provider', 'word-file', 'word-summary', 'word-count',
  'word-file-name', 'keyword-list', 'image-summary', 'manual-facts', 'product-tabs',
  'empty-state', 'product-form', 'title', 'title-count', 'selling-points',
  'keywords', 'manual-create', 'new-manual-create', 'ai-generate', 'ai-generate-similar', 'save-task',
  'action-message', 'service-state', 'ali-gateway', 'ali-app-key', 'ali-app-secret',
  'ali-access-token', 'ali-auth-code', 'ali-authorize', 'ali-exchange', 'ali-remember',
  'ali-save', 'ali-test', 'ali-status', 'ali-active-state', 'source-product-id',
  'load-source-product', 'source-product-status', 'template-banner', 'template-product-id',
  'image-section', 'details-section', 'schema-recognition', 'recognition-title',
  'recognition-summary', 'recognition-faq', 'recognition-attributes', 'recognition-images',
  'generate-previews', 'generate-image-previews',
  'preview-summary', 'similar-main-images', 'auxiliary-image-pool', 'auxiliary-image-list',
  'assigned-images', 'custom-attribute-rows', 'faq-rows', 'add-custom-attribute',
  'upload-photobank', 'photobank-status', 'ali-photobank-group',
  'top-local-state', 'top-alibaba-state', 'top-batch-state', 'top-last-saved',
  'pool-search', 'pool-stage', 'pool-sort', 'pool-table-body', 'pool-empty',
  'pool-count', 'pool-page', 'pool-prev', 'pool-next', 'pool-refresh', 'pool-export',
  'product-drawer', 'drawer-backdrop', 'drawer-close', 'drawer-title', 'drawer-subtitle',
  'drawer-tabs', 'drawer-content', 'current-batch-panel', 'current-batch-caption',
  'current-batch-list',
  'metric-batches', 'metric-products', 'metric-ready', 'metric-attention', 'recent-batches',
  'stage-materials', 'stage-keywords', 'stage-ai', 'stage-photobank', 'stage-preview', 'stage-save',
];

const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function setStatus(element, message, type = '') {
  element.textContent = message;
  element.classList.remove('success', 'error');
  if (type) element.classList.add(type);
}

const { requestJson } = initLocalServiceConnection();

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
  button.disabled = busy;
}

const keywordRecordsController = initKeywordRecords({ requestJson });

function switchModule(moduleName) {
  document.querySelectorAll('.module-link').forEach((button) => {
    const active = button.dataset.module === moduleName;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.module-page').forEach((page) => {
    const active = page.id === `module-${moduleName}`;
    page.classList.toggle('active', active);
    page.hidden = !active;
  });
  if (moduleName === 'product-pool' || moduleName === 'dashboard') loadProductPool();
  if (moduleName === 'keyword-records') keywordRecordsController.load();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const poolStageLabels = {
  'needs-content': '待补内容',
  'needs-images': '待传图片',
  'needs-preview': '待生成预览',
  'preview-ready': '预览完成',
};

function formatPoolDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getFilteredProductRows() {
  const [sortKey, direction] = state.productPoolSort.split(':');
  return sortProductRows(
    filterProductRows(state.productRows, state.productPoolQuery, state.productPoolStage),
    sortKey,
    direction,
  );
}

function renderDashboard() {
  const summary = summarizeDashboard(state.taskSummaries, state.productRows);
  elements['metric-batches'].textContent = summary.batchCount;
  elements['metric-products'].textContent = summary.productCount;
  elements['metric-ready'].textContent = summary.readyCount;
  elements['metric-attention'].textContent = summary.needsAttentionCount;

  if (!state.taskSummaries.length) {
    const empty = document.createElement('div');
    empty.className = 'placeholder-copy';
    const title = document.createElement('strong');
    title.textContent = '还没有保存任务';
    const copy = document.createElement('p');
    copy.textContent = '从自动上品页保存第一批商品后会显示在这里。';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'button quiet';
    action.dataset.goModule = 'auto-listing';
    action.textContent = '去创建商品';
    action.addEventListener('click', () => switchModule('auto-listing'));
    empty.append(title, copy, action);
    elements['recent-batches'].replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.taskSummaries.slice(0, 5).forEach((task) => {
    const row = document.createElement('article');
    row.className = 'recent-row';
    const id = document.createElement('strong');
    id.textContent = task.id;
    const productCount = document.createElement('span');
    productCount.textContent = `${task.products.length} 个商品`;
    const source = document.createElement('span');
    source.textContent = task.sourceProductId ? `主产品 ${task.sourceProductId}` : '本地新建';
    const progressWrap = document.createElement('div');
    const progress = document.createElement('div');
    progress.className = 'recent-progress';
    const progressValue = document.createElement('i');
    const percent = task.products.length ? Math.round((task.previewCount / task.products.length) * 100) : 0;
    progressValue.style.width = `${percent}%`;
    progress.append(progressValue);
    const progressLabel = document.createElement('span');
    progressLabel.textContent = `预览 ${task.previewCount}/${task.products.length}`;
    progressWrap.append(progress, progressLabel);
    const action = document.createElement('button');
    action.type = 'button';
    action.dataset.recentTask = task.id;
    action.textContent = '查看商品';
    row.append(id, productCount, source, progressWrap, action);
    fragment.append(row);
  });
  elements['recent-batches'].replaceChildren(fragment);
}

function updateStage(id, complete, started, completeText, pendingText) {
  const stage = elements[id];
  stage.classList.toggle('complete', complete);
  stage.classList.toggle('attention', !complete && started);
  stage.querySelector('em').textContent = complete ? completeText : pendingText;
}

function renderWorkflowStages() {
  const editableProducts = state.products.length > 4 ? state.products.slice(-4) : state.products.slice(0, 4);
  const hasWork = editableProducts.length > 0;
  const materialsReady = state.mainImageFiles.filter(Boolean).length === 4 && state.auxiliaryImageFiles.length >= 5;
  const keywordsReady = state.words.length > 0;
  const aiReady = editableProducts.length === 4 && editableProducts.every((product) => (
    Boolean(product.title?.trim())
    && (product.faqItems || []).slice(0, 5).length === 5
    && (product.faqItems || []).slice(0, 5).every((item) => item.question?.trim() && item.answer?.trim())
    && (product.customAttributes || []).length > 0
  ));
  const photobankReady = editableProducts.length === 4 && editableProducts.every(productImageReady);
  const previewReady = editableProducts.length === 4 && editableProducts.every((product) => product.preview?.changedFields?.includes('images'));
  updateStage('stage-materials', materialsReady, state.mainImageFiles.some(Boolean) || state.auxiliaryImageFiles.length > 0, '已备齐', '待准备');
  updateStage('stage-keywords', keywordsReady, Boolean(state.wordFileName), `${state.words.length} 个词`, '待导入');
  updateStage('stage-ai', aiReady, hasWork, '内容完整', '待完善');
  updateStage('stage-photobank', photobankReady, Object.keys(state.photobankUploads).length > 0, '上传完成', '待上传');
  updateStage('stage-preview', previewReady, editableProducts.some((product) => product.preview), '预览完成', '待生成');
  updateStage('stage-save', state.currentTaskSaved, hasWork, '已保存', '未保存');
}

function makeCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function makeReadinessCell(ready) {
  const cell = document.createElement('td');
  const mark = document.createElement('span');
  mark.className = `readiness-mark${ready ? ' ready' : ''}`;
  mark.textContent = ready ? '完成' : '待补';
  cell.append(mark);
  return cell;
}

function appendFact(container, label, value) {
  const fact = document.createElement('div');
  fact.className = 'drawer-fact';
  const name = document.createElement('span');
  name.textContent = label;
  const content = document.createElement('strong');
  content.textContent = String(value || '—');
  fact.append(name, content);
  container.append(fact);
}

function appendBlock(container, title, value) {
  const block = document.createElement('section');
  block.className = 'drawer-block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = String(value || '—');
  block.append(heading, body);
  container.append(block);
}

function appendList(container, title, items, formatItem) {
  const block = document.createElement('section');
  block.className = 'drawer-block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('ul');
  list.className = 'drawer-list';
  const values = Array.isArray(items) ? items : [];
  if (!values.length) {
    const item = document.createElement('li');
    item.textContent = '暂无内容';
    list.append(item);
  } else {
    values.forEach((value, index) => {
      const item = document.createElement('li');
      item.textContent = formatItem(value, index);
      list.append(item);
    });
  }
  block.append(heading, list);
  container.append(block);
}

const drawerTabLabels = {
  overview: '概览',
  images: '图片',
  copy: '文案',
  details: '属性与 FAQ',
  schema: 'Schema 预览',
  logs: '日志',
};

function renderDrawerContent() {
  const task = state.drawerTask || {};
  const product = state.drawerProduct || {};
  const row = state.drawerRow || {};
  const content = elements['drawer-content'];
  const section = document.createElement('div');
  section.className = 'drawer-section';

  if (state.drawerTab === 'overview') {
    const facts = document.createElement('div');
    facts.className = 'drawer-facts';
    appendFact(facts, '任务编号', task.id);
    appendFact(facts, '主产品 ID', task.source?.sourceProductId || '本地新建');
    appendFact(facts, '类似品序号', product.index ? `#${product.index}` : '—');
    appendFact(facts, '当前阶段', poolStageLabels[row.stage] || row.stage);
    appendFact(facts, '生成方式', task.generation?.mode || 'manual');
    appendFact(facts, '保存时间', formatPoolDate(task.createdAt));
    section.append(facts);
    appendList(section, '需要处理', row.issues, (item) => item);
  } else if (state.drawerTab === 'images') {
    const assignment = product.imageAssignment || {};
    const keys = [
      Number.isInteger(assignment.mainImageIndex) ? `main:${assignment.mainImageIndex}` : '',
      ...(assignment.auxiliaryImageIndexes || []).map((index) => `auxiliary:${index}`),
    ].filter(Boolean);
    const uploads = task.source?.photobankUploads || {};
    const list = document.createElement('div');
    list.className = 'drawer-image-list';
    keys.forEach((key, index) => {
      const rowElement = document.createElement('div');
      rowElement.className = 'drawer-image-row';
      const label = document.createElement('span');
      label.textContent = index === 0 ? '主图' : `副图 ${index}`;
      const upload = uploads[key];
      if (upload?.photobankUrl) {
        const link = document.createElement('a');
        link.href = upload.photobankUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = upload.photobankUrl;
        rowElement.append(label, link);
      } else {
        const missing = document.createElement('span');
        missing.textContent = '尚未上传到图片银行';
        rowElement.append(label, missing);
      }
      list.append(rowElement);
    });
    if (!keys.length) appendBlock(section, '图片分配', '尚未分配图片');
    else section.append(list);
  } else if (state.drawerTab === 'copy') {
    appendBlock(section, '商品标题', product.title);
    appendBlock(section, '主题卖点', product.sellingPoints);
    appendBlock(section, '采用关键词', (product.keywords || []).join(', '));
  } else if (state.drawerTab === 'details') {
    appendList(section, '自定义属性', product.customAttributes, (item) => `${item.name || '未命名'}：${item.value || '未填写'}`);
    appendList(section, 'FAQ 前 5 条', (product.faqItems || []).slice(0, 5), (item, index) => `${index + 1}. ${item.question || '未填写问题'}\n${item.answer || '未填写回答'}`);
  } else if (state.drawerTab === 'schema') {
    appendBlock(section, '本地预览状态', product.preview?.previewXml ? '已生成本地 Schema 预览（未提交到阿里）' : '尚未生成');
    appendList(section, '已变更字段', product.preview?.changedFields, (item) => item);
  } else {
    appendList(section, '本地记录', [
      `任务创建：${formatPoolDate(task.createdAt)}`,
      `任务状态：${task.status || 'prepared'}`,
      `生成方式：${task.generation?.mode || 'manual'}`,
      `图片银行记录：${Object.keys(task.source?.photobankUploads || {}).length} 张`,
    ], (item) => item);
  }
  content.replaceChildren(section);
}

function renderDrawerTabs() {
  const fragment = document.createDocumentFragment();
  Object.entries(drawerTabLabels).forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `drawer-tab${state.drawerTab === key ? ' active' : ''}`;
    button.dataset.drawerTab = key;
    button.setAttribute('aria-selected', String(state.drawerTab === key));
    button.textContent = label;
    fragment.append(button);
  });
  elements['drawer-tabs'].replaceChildren(fragment);
}

async function openProductDrawer(row, trigger) {
  state.drawerTrigger = trigger;
  setBusy(trigger, true, '读取中…');
  try {
    const task = await requestJson(`/api/tasks/${encodeURIComponent(row.taskId)}`);
    const product = (task.products || []).find((item) => Number(item.index) === Number(row.productIndex));
    if (!product) throw new Error('任务中找不到这个商品');
    state.drawerTask = task;
    state.drawerProduct = product;
    state.drawerRow = row;
    state.drawerTab = 'overview';
    elements['drawer-title'].textContent = product.title || '未填写标题';
    elements['drawer-subtitle'].textContent = `任务 ${task.id} · 只读查看，不会提交到阿里`;
    renderDrawerTabs();
    renderDrawerContent();
    elements['drawer-backdrop'].hidden = false;
    elements['product-drawer'].hidden = false;
    elements['drawer-close'].focus();
  } catch (error) {
    setStatus(elements['action-message'], `商品详情读取失败：${error.message}`, 'error');
  } finally {
    setBusy(trigger, false);
  }
}

function closeProductDrawer() {
  if (elements['product-drawer'].hidden) return;
  elements['product-drawer'].hidden = true;
  elements['drawer-backdrop'].hidden = true;
  state.drawerTrigger?.focus();
}

function productImageReady(product) {
  const assignment = product?.imageAssignment;
  if (!assignment) return false;
  const keys = [
    `main:${assignment.mainImageIndex}`,
    ...(assignment.auxiliaryImageIndexes || []).map((index) => `auxiliary:${index}`),
  ];
  return keys.length === 6 && keys.every((key) => (
    state.photobankUploads[key]?.fileId && state.photobankUploads[key]?.photobankUrl
  ));
}

function renderCurrentBatch() {
  const products = state.products.length > 4 ? state.products.slice(-4) : state.products.slice(0, 4);
  elements['current-batch-caption'].textContent = products.length ? `${products.length} 个类似品正在编辑` : '尚未创建商品';
  if (!products.length) {
    const empty = document.createElement('p');
    empty.textContent = '读取一个主产品或创建空白版本后，这里会显示 4 个类似品的完成情况。';
    elements['current-batch-list'].replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  products.forEach((product, index) => {
    const card = document.createElement('article');
    card.className = 'batch-product';
    const title = document.createElement('strong');
    title.textContent = product.title || `类似品 ${index + 1} · 未填写标题`;
    const statuses = document.createElement('span');
    const contentReady = Boolean(product.title) && (product.faqItems || []).length >= 5 && (product.customAttributes || []).length > 0;
    const flags = [
      ['内容', contentReady],
      ['图片', productImageReady(product)],
      ['预览', Boolean(product.preview?.changedFields?.includes('images'))],
    ];
    flags.forEach(([label, ready]) => {
      const status = document.createElement('em');
      status.className = ready ? 'ready' : '';
      status.textContent = `${label}${ready ? '完成' : '待补'}`;
      statuses.append(status);
    });
    card.append(title, statuses);
    fragment.append(card);
  });
  elements['current-batch-list'].replaceChildren(fragment);
}

function renderProductPool() {
  const rows = getFilteredProductRows();
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.productPoolPage = Math.min(Math.max(1, state.productPoolPage), totalPages);
  const pageRows = rows.slice((state.productPoolPage - 1) * pageSize, state.productPoolPage * pageSize);
  const fragment = document.createDocumentFragment();

  pageRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(row.taskId || '—', 'pool-id'),
      makeCell(row.title || '未填写标题', 'pool-title-cell'),
      makeCell(row.sourceProductId || '本地新建'),
      makeCell(row.productIndex ? `#${row.productIndex}` : '—'),
      makeReadinessCell(row.contentReady),
      makeReadinessCell(row.imageReady),
      makeReadinessCell(row.schemaReady),
    );
    const stageCell = document.createElement('td');
    const stage = document.createElement('span');
    stage.className = `stage-chip ${row.stage}`;
    stage.textContent = poolStageLabels[row.stage] || row.stage;
    stage.title = row.issues.join('；');
    stageCell.append(stage);
    tr.append(stageCell, makeCell(formatPoolDate(row.updatedAt)));
    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'pool-row-action';
    action.textContent = '查看';
    action.dataset.taskId = row.taskId;
    action.dataset.productIndex = String(row.productIndex);
    actionCell.append(action);
    tr.append(actionCell);
    fragment.append(tr);
  });

  elements['pool-table-body'].replaceChildren(fragment);
  elements['pool-empty'].hidden = rows.length > 0;
  elements['pool-table-body'].closest('table').hidden = rows.length === 0;
  elements['pool-count'].textContent = `${rows.length} 个商品`;
  elements['pool-page'].textContent = `第 ${state.productPoolPage} / ${totalPages} 页`;
  elements['pool-prev'].disabled = state.productPoolPage <= 1;
  elements['pool-next'].disabled = state.productPoolPage >= totalPages;
  elements['pool-export'].disabled = rows.length === 0;
}

async function loadProductPool() {
  setBusy(elements['pool-refresh'], true, '刷新中…');
  try {
    const result = await requestJson('/api/tasks');
    state.taskSummaries = result.tasks;
    state.productRows = buildProductRows(result.tasks);
    renderDashboard();
    renderProductPool();
  } catch (error) {
    state.taskSummaries = [];
    state.productRows = [];
    renderDashboard();
    renderProductPool();
    setStatus(elements['action-message'], `产品池读取失败：${error.message}`, 'error');
  } finally {
    setBusy(elements['pool-refresh'], false);
  }
}

function exportProductPool() {
  const rows = getFilteredProductRows();
  if (!rows.length) return;
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csvRows = [
    ['任务编号', '商品标题', '主产品ID', '类似品序号', '当前阶段', '问题'],
    ...rows.map((row) => [
      row.taskId, row.title, row.sourceProductId, row.productIndex,
      poolStageLabels[row.stage] || row.stage, row.issues.join('；'),
    ]),
  ];
  const blob = new Blob([`\uFEFF${csvRows.map((row) => row.map(quote).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `商品池-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getAiConfig() {
  return {
    provider: elements.provider.value,
    baseUrl: elements['base-url'].value.trim(),
    apiKey: elements['api-key'].value.trim(),
    model: elements.model.value.trim(),
  };
}

function applyProviderPreset() {
  const provider = elements.provider.value;
  elements['base-url'].value = providerPresets[provider];
  elements['active-provider'].textContent = providerNames[provider];
}

function restoreAiProfile() {
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem(storageKeys.aiProfile) || '{}'); } catch { profile = {}; }
  elements.provider.value = profile.provider || 'openai';
  elements['base-url'].value = profile.baseUrl || providerPresets[elements.provider.value];
  elements.model.value = profile.model || '';
  const persistentKey = localStorage.getItem(storageKeys.persistentKey) || '';
  const sessionKey = sessionStorage.getItem(storageKeys.sessionKey) || '';
  elements['api-key'].value = persistentKey || sessionKey;
  elements['remember-key'].checked = Boolean(persistentKey);
  elements['active-provider'].textContent = providerNames[elements.provider.value];
}

function saveAiProfile() {
  const config = getAiConfig();
  localStorage.setItem(storageKeys.aiProfile, JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
  }));
  if (elements['remember-key'].checked) {
    localStorage.setItem(storageKeys.persistentKey, config.apiKey);
    sessionStorage.removeItem(storageKeys.sessionKey);
  } else {
    localStorage.removeItem(storageKeys.persistentKey);
    sessionStorage.setItem(storageKeys.sessionKey, config.apiKey);
  }
  elements['active-provider'].textContent = providerNames[config.provider];
  setStatus(elements['ai-status'], elements['remember-key'].checked
    ? '设置已保存在这台电脑的浏览器中。'
    : '接口设置已保存；API Key 仅保留到关闭浏览器。', 'success');
}

function getAlibabaConfig() {
  return {
    gatewayUrl: elements['ali-gateway'].value.trim(),
    appKey: elements['ali-app-key'].value.trim(),
    appSecret: elements['ali-app-secret'].value.trim(),
    accessToken: elements['ali-access-token'].value.trim(),
  };
}

function restoreAlibabaProfile() {
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem(storageKeys.alibabaProfile) || '{}'); } catch { profile = {}; }
  elements['ali-gateway'].value = profile.gatewayUrl || 'https://open-api.alibaba.com';
  elements['ali-app-key'].value = profile.appKey || '';
  elements['ali-photobank-group'].value = profile.photobankGroupId || '';
  const persistentSecret = localStorage.getItem(storageKeys.alibabaPersistentSecret) || '';
  const persistentToken = localStorage.getItem(storageKeys.alibabaPersistentToken) || '';
  const persistentRefreshToken = localStorage.getItem(storageKeys.alibabaPersistentRefreshToken) || '';
  elements['ali-app-secret'].value = persistentSecret || sessionStorage.getItem(storageKeys.alibabaSessionSecret) || '';
  elements['ali-access-token'].value = persistentToken || sessionStorage.getItem(storageKeys.alibabaSessionToken) || '';
  state.alibabaRefreshToken = persistentRefreshToken
    || sessionStorage.getItem(storageKeys.alibabaSessionRefreshToken)
    || '';
  elements['ali-remember'].checked = Boolean(persistentSecret || persistentToken);
  if (profile.appKey) elements['ali-active-state'].textContent = '配置待验证';
}

function saveAlibabaProfile() {
  const config = getAlibabaConfig();
  localStorage.setItem(storageKeys.alibabaProfile, JSON.stringify({
    gatewayUrl: config.gatewayUrl,
    appKey: config.appKey,
    photobankGroupId: elements['ali-photobank-group'].value.trim(),
  }));
  if (elements['ali-remember'].checked) {
    localStorage.setItem(storageKeys.alibabaPersistentSecret, config.appSecret);
    localStorage.setItem(storageKeys.alibabaPersistentToken, config.accessToken);
    if (state.alibabaRefreshToken) {
      localStorage.setItem(storageKeys.alibabaPersistentRefreshToken, state.alibabaRefreshToken);
    }
    sessionStorage.removeItem(storageKeys.alibabaSessionSecret);
    sessionStorage.removeItem(storageKeys.alibabaSessionToken);
    sessionStorage.removeItem(storageKeys.alibabaSessionRefreshToken);
  } else {
    localStorage.removeItem(storageKeys.alibabaPersistentSecret);
    localStorage.removeItem(storageKeys.alibabaPersistentToken);
    localStorage.removeItem(storageKeys.alibabaPersistentRefreshToken);
    sessionStorage.setItem(storageKeys.alibabaSessionSecret, config.appSecret);
    sessionStorage.setItem(storageKeys.alibabaSessionToken, config.accessToken);
    if (state.alibabaRefreshToken) {
      sessionStorage.setItem(storageKeys.alibabaSessionRefreshToken, state.alibabaRefreshToken);
    }
  }
  elements['ali-active-state'].textContent = '配置待验证';
  setStatus(elements['ali-status'], elements['ali-remember'].checked
    ? '阿里配置已保存在这台电脑的浏览器中。'
    : 'App Key 和网关已保存；Secret 与 Token 仅保留到关闭浏览器。', 'success');
  window.dispatchEvent(new Event('alibaba-config-updated'));
}

function getAlibabaAuthorizationCode(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    return new URL(input).searchParams.get('code') || input;
  } catch {
    return input;
  }
}

function openAlibabaAuthorization() {
  const appKey = elements['ali-app-key'].value.trim();
  if (!appKey) {
    setStatus(elements['ali-status'], '请先填写 App Key。', 'error');
    elements['ali-app-key'].focus();
    return;
  }
  const url = new URL('https://open-api.alibaba.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', 'https://www.alibaba.com');
  url.searchParams.set('force_auth', 'true');
  url.searchParams.set('client_id', appKey);
  url.searchParams.set('state', `icbu-workbench-${Date.now()}`);
  window.open(url, '_blank', 'noopener,noreferrer');
  setStatus(elements['ali-status'], '授权页已打开。完成授权后，把地址栏里的完整网址粘贴到授权码输入框。');
}

async function exchangeAlibabaAuthorizationCode() {
  const code = getAlibabaAuthorizationCode(elements['ali-auth-code'].value);
  if (!code) {
    setStatus(elements['ali-status'], '请粘贴授权后的完整网址或授权码。', 'error');
    return;
  }
  setBusy(elements['ali-exchange'], true, '正在换取…');
  setStatus(elements['ali-status'], '正在安全换取 Access Token');
  try {
    const result = await requestJson('/api/alibaba/token', {
      method: 'POST',
      body: JSON.stringify({ config: getAlibabaConfig(), code }),
    });
    elements['ali-access-token'].value = result.accessToken;
    state.alibabaRefreshToken = result.refreshToken || '';
    elements['ali-auth-code'].value = '';
    saveAlibabaProfile();
    elements['ali-active-state'].textContent = 'Token 已获取';
    const expires = result.expiresIn ? `，有效期 ${result.expiresIn} 秒` : '';
    setStatus(elements['ali-status'], `Access Token 已获取${expires}。下一步请测试阿里连接。`, 'success');
  } catch (error) {
    elements['ali-active-state'].textContent = '授权失败';
    setStatus(elements['ali-status'], error.message, 'error');
  } finally {
    setBusy(elements['ali-exchange'], false);
  }
}

function parseWordText(text, fileName) {
  const content = text.replace(/^\uFEFF/, '');
  const values = fileName.toLowerCase().endsWith('.csv')
    ? content.split(/[,\r\n]+/)
    : content.split(/[\n\r,;\t]+/);
  const seen = new Set();
  return values
    .map((value) => value.replace(/^"|"$/g, '').trim())
    .filter((value, index) => {
      const key = value.toLowerCase();
      const looksLikeHeader = index < 2 && /^(keyword|keywords|关键词|category|分类)$/i.test(value);
      if (!value || looksLikeHeader || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderKeywords() {
  elements['word-count'].textContent = `${state.words.length} 个词`;
  elements['word-file-name'].textContent = state.wordFileName || '尚未上传文件';
  elements['word-summary'].textContent = state.wordFileName
    ? `${state.wordFileName} · 已自动去重`
    : '支持 XLSX、CSV、TXT；会自动去重';
  renderWorkflowStages();
  if (!state.words.length) {
    elements['keyword-list'].innerHTML = '<p class="empty-copy">上传后会在这里检查读取结果。</p>';
    return;
  }
  elements['keyword-list'].replaceChildren(...state.words.map((word) => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = word;
    return chip;
  }));
}

function syncCurrentProduct() {
  const product = state.products[state.currentIndex];
  if (!product) return;
  product.title = elements.title.value.trim();
  product.customAttributes = [...elements['custom-attribute-rows'].querySelectorAll('.attribute-row')]
    .map((row) => ({
      name: row.querySelector('.attribute-name')?.value.trim() || '',
      value: row.querySelector('.attribute-value')?.value.trim() || '',
    }));
  product.sellingPoints = elements['selling-points'].value.trim();
  product.faqItems = [...elements['faq-rows'].querySelectorAll('.faq-row')]
    .map((row) => ({
      question: row.querySelector('.faq-question')?.value.trim() || '',
      answer: row.querySelector('.faq-answer')?.value.trim() || '',
    }));
  product.faq = formatFaqItems(product.faqItems);
  product.keywords = elements.keywords.value
    .split(/[,\n;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function renderTabs() {
  elements['product-tabs'].replaceChildren(...state.products.map((product, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `product-tab${index === state.currentIndex ? ' active' : ''}${product.title ? ' complete' : ''}`;
    const name = product.kind === 'base'
      ? '基础商品'
      : `类似品 ${state.mode === 'template' ? index + 1 : index}`;
    button.innerHTML = `<strong>${String(index + 1).padStart(2, '0')} · ${name}</strong><span>${product.title ? '已有内容' : '等待填写'}</span>`;
    button.addEventListener('click', () => {
      syncCurrentProduct();
      state.currentIndex = index;
      renderEditor();
    });
    return button;
  }));
}

function formatFaqItems(items = []) {
  return items.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n');
}

function schemaIsReady(analysis) {
  const recognized = analysis?.recognized || {};
  return Boolean(
    recognized.title
    && recognized.productSummary
    && recognized.faq
    && recognized.faq.items?.length >= 5
    && recognized.customAttributes,
  );
}

function renderSchemaRecognition(analysis) {
  const entries = [
    ['recognition-title', analysis?.recognized?.title],
    ['recognition-summary', analysis?.recognized?.productSummary],
    ['recognition-faq', analysis?.recognized?.faq?.items?.length ? analysis.recognized.faq : null],
    ['recognition-attributes', analysis?.recognized?.customAttributes],
    ['recognition-images', analysis?.recognized?.images?.items?.length ? analysis.recognized.images : null],
  ];
  entries.forEach(([id, recognized]) => {
    elements[id].textContent = recognized ? '已识别' : '需确认';
    elements[id].classList.toggle('warning', !recognized);
  });
}

function renderEditor() {
  const product = state.products[state.currentIndex];
  const hasProducts = Boolean(product);
  elements['empty-state'].classList.toggle('hidden', hasProducts);
  elements['product-form'].classList.toggle('hidden', !hasProducts);
  elements['save-task'].disabled = !hasProducts;
  elements['new-manual-create'].classList.toggle('hidden', hasProducts);
  const inheritsTemplate = state.mode === 'template' && Boolean(state.sourceTemplate);
  elements['template-banner'].classList.toggle('hidden', !inheritsTemplate);
  elements['ai-generate'].classList.toggle('hidden', inheritsTemplate);
  elements['ai-generate-similar'].classList.toggle('hidden', !inheritsTemplate);
  elements['generate-previews'].classList.toggle('hidden', !inheritsTemplate);
  elements['generate-image-previews'].classList.toggle('hidden', !inheritsTemplate);
  elements['generate-previews'].disabled = !inheritsTemplate || !schemaIsReady(state.sourceTemplate?.analysis);
  updatePhotobankControls();
  renderSchemaRecognition(state.sourceTemplate?.analysis);
  renderTabs();
  renderCurrentBatch();
  renderWorkflowStages();
  if (!product) return;
  elements['template-product-id'].textContent = product.sourceProductId || '—';
  elements.title.value = product.title || '';
  renderAttributeRows(elements['custom-attribute-rows'], product.customAttributes || [], product.attributeChanges || []);
  elements['selling-points'].value = product.sellingPoints || '';
  renderFaqRows(elements['faq-rows'], product.faqItems || []);
  elements.keywords.value = (product.keywords || []).join(', ');
  elements['title-count'].textContent = elements.title.value.length;
  elements['preview-summary'].classList.toggle('hidden', !inheritsTemplate || !product.preview);
  if (product.preview) {
    const fields = product.preview.changedFields.join('、');
    elements['preview-summary'].querySelector('strong').textContent = `已修改：${fields}`;
    elements['preview-summary'].querySelector('p').textContent = '预览 XML 已保存在当前本地任务中；未提交到阿里。';
  }
  renderAssignedImages();
}

function invalidateImagePreviews() {
  state.products.forEach((product) => {
    if (product.preview?.changedFields?.includes('images')) delete product.preview;
  });
}

function renderMainImageSlot(index, file) {
  const input = document.getElementById(`main-image-${index + 1}`);
  const slot = input.closest('.image-slot');
  const image = slot.querySelector('img');
  if (state.mainImageUrls[index]) URL.revokeObjectURL(state.mainImageUrls[index]);
  state.mainImageFiles[index] = file || null;
  delete state.photobankUploads[`main:${index}`];
  invalidateImagePreviews();
  state.mainImageUrls[index] = file ? URL.createObjectURL(file) : '';
  slot.classList.toggle('has-image', Boolean(file));
  image.src = state.mainImageUrls[index];
  updateImageSummary();
  renderAssignedImages();
  updatePhotobankControls();
}

function buildDefaultImageAssignments() {
  if (state.auxiliaryImageFiles.length < 5) return [];
  return Array.from({ length: 4 }, (_, productIndex) => ({
    mainImageIndex: productIndex,
    auxiliaryImageIndexes: Array.from(
      { length: 5 },
      (_unused, offset) => (productIndex + offset) % state.auxiliaryImageFiles.length,
    ),
  }));
}

function updateImageSummary() {
  const mainCount = state.mainImageFiles.filter(Boolean).length;
  elements['image-summary'].textContent = `主图 ${mainCount} / 4 · 副图 ${state.auxiliaryImageFiles.length}`;
  state.currentTaskSaved = false;
  renderWorkflowStages();
}

function updatePhotobankControls() {
  let uploads = [];
  try {
    uploads = collectAssignedFilesForUpload(
      state.mainImageFiles,
      state.auxiliaryImageFiles,
      state.products,
    );
  } catch {
    elements['upload-photobank'].disabled = true;
    elements['generate-image-previews'].disabled = true;
    setStatus(elements['photobank-status'], '请先准备 4 张主图，并为每套商品分配 5 张副图。');
    return;
  }

  const completed = uploads.filter((upload) => state.photobankUploads[upload.key]).length;
  elements['upload-photobank'].disabled = completed === uploads.length;
  let fullPreviewReady = false;
  if (completed === uploads.length && state.sourceTemplate?.analysis?.recognized?.images) {
    try {
      state.products.forEach((product, index) => {
        resolveAlibabaImages(product, state.photobankUploads, index);
      });
      fullPreviewReady = true;
    } catch {
      fullPreviewReady = false;
    }
  }
  elements['generate-image-previews'].disabled = !fullPreviewReady;
  setStatus(
    elements['photobank-status'],
    completed === uploads.length && !state.sourceTemplate?.analysis?.recognized?.images
      ? '图片已上传，但主产品 Schema 未识别商品图片字段。'
      : completed === uploads.length
        ? `${completed} 张分配图片已上传；可以生成完整本地预览。`
      : `待上传 ${uploads.length - completed} 张；已上传 ${completed} 张。`,
    completed === uploads.length ? 'success' : '',
  );
}

function renderAuxiliaryPool() {
  if (!state.auxiliaryImageUrls.length) {
    elements['auxiliary-image-list'].innerHTML = '<span>尚未上传副图</span>';
    return;
  }
  elements['auxiliary-image-list'].replaceChildren(...state.auxiliaryImageUrls.map((url, index) => {
    const item = document.createElement('span');
    item.className = 'auxiliary-thumb';
    item.innerHTML = `<img alt="副图 ${index + 1}"><b>${String(index + 1).padStart(2, '0')}</b>`;
    item.querySelector('img').src = url;
    return item;
  }));
}

function renderAssignedImages() {
  const product = state.products[state.currentIndex];
  const assignment = product?.imageAssignment;
  if (!product || !assignment) {
    elements['assigned-images'].innerHTML = '<p class="empty-copy">上传至少 5 张副图后自动分配。</p>';
    return;
  }
  const cards = [];
  const mainCard = document.createElement('div');
  mainCard.className = 'assigned-image-card main';
  mainCard.innerHTML = '<span>主图</span><img alt="当前类似品主图">';
  mainCard.querySelector('img').src = state.mainImageUrls[assignment.mainImageIndex] || '';
  cards.push(mainCard);

  assignment.auxiliaryImageIndexes.forEach((imageIndex, slotIndex) => {
    const card = document.createElement('label');
    card.className = 'assigned-image-card';
    card.innerHTML = `<span>副图 ${slotIndex + 1}</span><img alt="副图 ${slotIndex + 1}"><select aria-label="替换副图 ${slotIndex + 1}"></select>`;
    card.querySelector('img').src = state.auxiliaryImageUrls[imageIndex] || '';
    const select = card.querySelector('select');
    state.auxiliaryImageFiles.forEach((file, optionIndex) => {
      const option = document.createElement('option');
      option.value = String(optionIndex);
      option.textContent = `${String(optionIndex + 1).padStart(2, '0')} · ${file.name}`;
      option.selected = optionIndex === imageIndex;
      select.append(option);
    });
    select.addEventListener('change', () => {
      const nextIndex = Number(select.value);
      const used = product.imageAssignment.auxiliaryImageIndexes;
      if (used.some((value, index) => index !== slotIndex && value === nextIndex)) {
        setStatus(elements['action-message'], '同一个类似品的 5 张副图不能重复。', 'error');
        select.value = String(imageIndex);
        return;
      }
      used[slotIndex] = nextIndex;
      product.manuallyEdited = true;
      invalidateImagePreviews();
      renderAssignedImages();
      updatePhotobankControls();
    });
    cards.push(card);
  });
  elements['assigned-images'].replaceChildren(...cards);
}

function setAuxiliaryImages(files) {
  state.auxiliaryImageUrls.forEach((url) => URL.revokeObjectURL(url));
  state.auxiliaryImageFiles = [...files];
  invalidateImagePreviews();
  Object.keys(state.photobankUploads)
    .filter((key) => key.startsWith('auxiliary:'))
    .forEach((key) => delete state.photobankUploads[key]);
  state.auxiliaryImageUrls = state.auxiliaryImageFiles.map((file) => URL.createObjectURL(file));
  const assignments = buildDefaultImageAssignments();
  state.products.forEach((product, index) => {
    if (assignments[index]) product.imageAssignment = structuredClone(assignments[index]);
  });
  updateImageSummary();
  renderAuxiliaryPool();
  renderAssignedImages();
  updatePhotobankControls();
}

async function uploadAssignedImagesToPhotobank() {
  let uploads;
  try {
    uploads = collectAssignedFilesForUpload(
      state.mainImageFiles,
      state.auxiliaryImageFiles,
      state.products,
    );
  } catch (error) {
    setStatus(elements['photobank-status'], error.message, 'error');
    return;
  }

  const pending = uploads.filter((upload) => !state.photobankUploads[upload.key]);
  if (!pending.length) {
    updatePhotobankControls();
    return;
  }
  const confirmed = window.confirm(
    `将 ${pending.length} 张图片上传到当前店铺的阿里图片银行。\n\n这会新增图片文件，但不会创建、修改或发布商品。是否继续？`,
  );
  if (!confirmed) return;

  setBusy(elements['upload-photobank'], true, `上传 0 / ${pending.length}`);
  let uploadError = '';
  try {
    for (let index = 0; index < pending.length; index += 1) {
      const upload = pending[index];
      elements['upload-photobank'].textContent = `上传 ${index + 1} / ${pending.length}`;
      setStatus(elements['photobank-status'], `正在上传 ${upload.file.name}…`);
      const result = await requestJson('/api/alibaba/photobank/upload', {
        method: 'POST',
        body: JSON.stringify({
          config: getAlibabaConfig(),
          groupId: elements['ali-photobank-group'].value.trim(),
          image: {
            fileName: upload.file.name,
            dataUrl: await fileToDataUrl(upload.file),
          },
        }),
      });
      state.photobankUploads[upload.key] = {
        ...result,
        originalFileName: upload.file.name,
      };
    }
    setStatus(
      elements['action-message'],
      `${pending.length} 张图片已上传到图片银行；仍未创建或发布商品。`,
      'success',
    );
  } catch (error) {
    uploadError = `上传中断：${error.message}。已成功的图片不会重复上传。`;
  } finally {
    setBusy(elements['upload-photobank'], false);
    updatePhotobankControls();
    if (uploadError) setStatus(elements['photobank-status'], uploadError, 'error');
  }
}

async function createManualProducts(button) {
  setBusy(button, true, '正在创建…');
  try {
    const result = await requestJson('/api/products/manual', { method: 'POST', body: '{}' });
    state.products = result.products.map((product, index) => ({
      ...product,
      customAttributes: [],
      faqItems: Array.from({ length: 5 }, () => ({ question: '', answer: '' })),
      imageAssignment: buildDefaultImageAssignments()[index] || null,
    }));
    state.currentIndex = 0;
    state.mode = 'manual';
    state.sourceTemplate = null;
    state.photobankUploads = {};
    state.currentTaskSaved = false;
    renderEditor();
    elements['top-batch-state'].textContent = '本地 1+4';
    setStatus(elements['action-message'], '已创建 1 个基础品和 4 个类似品；手工填写不会消耗模型用量。', 'success');
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function loadSourceProduct() {
  const productId = elements['source-product-id'].value.trim();
  if (!/^\d+$/.test(productId)) {
    setStatus(elements['source-product-status'], '请填写数字格式的主产品 ID。', 'error');
    return;
  }
  setBusy(elements['load-source-product'], true, '正在读取…');
  setStatus(elements['source-product-status'], '正在通过只读 Schema 接口读取主产品…');
  try {
    const template = await requestJson('/api/alibaba/product-template', {
      method: 'POST',
      body: JSON.stringify({ config: getAlibabaConfig(), productId }),
    });
    const result = await requestJson('/api/products/similar', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
    state.sourceTemplate = template;
    const recognized = template.analysis?.recognized || {};
    const originalFaqItems = (recognized.faq?.items || []).slice(0, 5);
    const imageAssignments = buildDefaultImageAssignments();
    state.products = result.products.map((product, index) => ({
      ...product,
      title: recognized.title?.value || '',
      sellingPoints: recognized.productSummary?.value || '',
      faqItems: structuredClone(originalFaqItems),
      faq: formatFaqItems(originalFaqItems),
      customAttributes: structuredClone(recognized.customAttributes?.items || []),
      attributeChanges: [],
      imageAssignment: imageAssignments[index] || null,
      manuallyEdited: false,
    }));
    state.currentIndex = 0;
    state.mode = 'template';
    state.photobankUploads = {};
    state.currentTaskSaved = false;
    renderEditor();
    elements['top-batch-state'].textContent = `主产品 ${productId}`;
    const trace = template.traceId ? ` · Trace ${template.traceId}` : '';
    setStatus(elements['source-product-status'], `主产品 ${productId} 已读取${trace}`, 'success');
    const ready = schemaIsReady(template.analysis);
    setStatus(
      elements['action-message'],
      ready
        ? '已创建 4 个类似品编辑位；可以修改文案并生成本地预览。'
        : '主产品已读取，但部分字段需要确认，暂不能生成预览。',
      ready ? 'success' : 'error',
    );
  } catch (error) {
    setStatus(elements['source-product-status'], error.message, 'error');
  } finally {
    setBusy(elements['load-source-product'], false);
  }
}

async function generateProductPreviews() {
  syncCurrentProduct();
  if (!state.sourceTemplate || state.products.length !== 4) {
    setStatus(elements['action-message'], '请先读取一个主产品。', 'error');
    return;
  }
  setBusy(elements['generate-previews'], true, '正在生成预览…');
  setStatus(elements['action-message'], '正在生成 4 份本地预览；不会提交到阿里。');
  try {
    const result = await requestJson('/api/products/preview', {
      method: 'POST',
      body: JSON.stringify({
        schemaXml: state.sourceTemplate.schemaXml,
        products: state.products,
      }),
    });
    state.products = state.products.map((product, index) => ({
      ...product,
      preview: result.previews[index],
    }));
    renderEditor();
    setStatus(elements['action-message'], '4 份本地预览已生成，均未提交到阿里。', 'success');
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(elements['generate-previews'], false);
  }
}

async function generateImageProductPreviews() {
  syncCurrentProduct();
  if (!state.sourceTemplate || state.products.length !== 4) {
    setStatus(elements['action-message'], '请先读取一个主产品。', 'error');
    return;
  }

  let products;
  try {
    products = state.products.map((product, index) => ({
      ...product,
      alibabaImages: resolveAlibabaImages(product, state.photobankUploads, index),
    }));
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
    return;
  }

  setBusy(elements['generate-image-previews'], true, '正在生成完整预览…');
  setStatus(elements['action-message'], '正在把图片银行信息写入 4 份本地 Schema；不会提交到阿里。');
  try {
    const result = await requestJson('/api/products/preview', {
      method: 'POST',
      body: JSON.stringify({
        schemaXml: state.sourceTemplate.schemaXml,
        products,
      }),
    });
    state.products = state.products.map((product, index) => ({
      ...product,
      preview: result.previews[index],
    }));
    renderEditor();
    setStatus(
      elements['action-message'],
      '4 份含图片的完整本地预览已生成；未创建草稿、未发布商品。',
      'success',
    );
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(elements['generate-image-previews'], false);
    updatePhotobankControls();
  }
}

async function compressedImagesForGeneration() {
  const mainImages = await Promise.all(state.mainImageFiles.map(async (file, index) => ({
    name: `main-${index + 1}:${file.name}`,
    dataUrl: await compressImage(file),
  })));
  const usedAuxiliaryIndexes = [...new Set(state.products.flatMap(
    (product) => product.imageAssignment?.auxiliaryImageIndexes || [],
  ))];
  const auxiliaryImages = await Promise.all(usedAuxiliaryIndexes.map(async (imageIndex) => ({
    name: `aux-${imageIndex + 1}:${state.auxiliaryImageFiles[imageIndex].name}`,
    dataUrl: await compressImage(state.auxiliaryImageFiles[imageIndex]),
  })));
  return [...mainImages, ...auxiliaryImages];
}

async function generateSimilarProductsFromTemplate() {
  syncCurrentProduct();
  if (!state.sourceTemplate || state.products.length !== 4) {
    setStatus(elements['action-message'], '请先读取一个主产品。', 'error');
    return;
  }
  const missingMain = state.mainImageFiles.findIndex((file) => !file);
  if (missingMain >= 0) {
    setStatus(elements['action-message'], `请上传类似品 ${missingMain + 1} 的主图。`, 'error');
    return;
  }
  if (state.auxiliaryImageFiles.length < 5) {
    setStatus(elements['action-message'], `副图至少需要 5 张，当前只有 ${state.auxiliaryImageFiles.length} 张。`, 'error');
    return;
  }
  if (!state.words.length) {
    setStatus(elements['action-message'], '请先在“关键词表”中上传并检查词表。', 'error');
    return;
  }
  const config = getAiConfig();
  if (!config.apiKey || !config.model) {
    setStatus(elements['action-message'], '请先在“AI 接口”中填写 API Key 和模型名称。', 'error');
    return;
  }
  if (state.products.some((product) => product.manuallyEdited)
    && !window.confirm('检测到手工修改。继续生成会替换四套当前内容，是否继续？')) return;

  const recognized = state.sourceTemplate.analysis?.recognized || {};
  const source = {
    imageAssignments: state.products.map((product) => product.imageAssignment),
    words: state.words,
    manualFacts: elements['manual-facts'].value.trim(),
    originalContent: {
      title: recognized.title?.value || '',
      sellingPoints: recognized.productSummary?.value || '',
      faqItems: (recognized.faq?.items || []).slice(0, 5),
      customAttributes: recognized.customAttributes?.items || [],
    },
  };

  setBusy(elements['ai-generate-similar'], true, '正在分析并生成…');
  setStatus(elements['action-message'], '正在压缩图片并生成 4 套内容；这一步会产生模型用量。');
  try {
    let useImages = true;
    let imageDataUrls = await compressedImagesForGeneration();
    let result;
    try {
      result = await requestJson('/api/products/generate-similar', {
        method: 'POST',
        body: JSON.stringify({ config, source: { ...source, useImages, imageDataUrls } }),
      });
    } catch (error) {
      const looksLikeVisionError = /image|vision|multimodal|图片|视觉/i.test(error.message);
      if (!looksLikeVisionError || !window.confirm(`当前模型可能不支持识图：${error.message}\n\n是否改用纯文字模式重新生成？`)) throw error;
      useImages = false;
      imageDataUrls = [];
      result = await requestJson('/api/products/generate-similar', {
        method: 'POST',
        body: JSON.stringify({ config, source: { ...source, useImages, imageDataUrls } }),
      });
    }
    state.products = result.products.map((product) => ({
      ...product,
      sourceProductId: state.sourceTemplate.sourceProductId,
      manuallyEdited: false,
      visionUsed: result.visionUsed,
    }));
    state.currentIndex = 0;
    renderEditor();
    setStatus(
      elements['action-message'],
      result.visionUsed
        ? '4 套内容已生成并结合图片识别，请逐个检查。'
        : '4 套内容已用纯文字模式生成，模型没有分析图片，请重点核对。',
      'success',
    );
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(elements['ai-generate-similar'], false);
  }
}

document.querySelectorAll('.module-link').forEach((button) => {
  button.addEventListener('click', () => switchModule(button.dataset.module));
});
document.querySelectorAll('[data-go-module]').forEach((button) => {
  button.addEventListener('click', () => switchModule(button.dataset.goModule));
});
elements['pool-search'].addEventListener('input', () => {
  state.productPoolQuery = elements['pool-search'].value;
  state.productPoolPage = 1;
  renderProductPool();
});
elements['pool-stage'].addEventListener('change', () => {
  state.productPoolStage = elements['pool-stage'].value;
  state.productPoolPage = 1;
  renderProductPool();
});
elements['pool-sort'].addEventListener('change', () => {
  state.productPoolSort = elements['pool-sort'].value;
  state.productPoolPage = 1;
  renderProductPool();
});
elements['pool-prev'].addEventListener('click', () => {
  state.productPoolPage -= 1;
  renderProductPool();
});
elements['pool-next'].addEventListener('click', () => {
  state.productPoolPage += 1;
  renderProductPool();
});
elements['pool-refresh'].addEventListener('click', loadProductPool);
elements['pool-export'].addEventListener('click', exportProductPool);
elements['pool-table-body'].addEventListener('click', (event) => {
  const button = event.target.closest('.pool-row-action');
  if (!button) return;
  const row = state.productRows.find((item) => (
    item.taskId === button.dataset.taskId
    && Number(item.productIndex) === Number(button.dataset.productIndex)
  ));
  if (row) openProductDrawer(row, button);
});
elements['drawer-tabs'].addEventListener('click', (event) => {
  const button = event.target.closest('[data-drawer-tab]');
  if (!button) return;
  state.drawerTab = button.dataset.drawerTab;
  renderDrawerTabs();
  renderDrawerContent();
});
elements['drawer-close'].addEventListener('click', closeProductDrawer);
elements['drawer-backdrop'].addEventListener('click', closeProductDrawer);
elements['recent-batches'].addEventListener('click', (event) => {
  const button = event.target.closest('[data-recent-task]');
  if (!button) return;
  state.productPoolQuery = button.dataset.recentTask;
  elements['pool-search'].value = state.productPoolQuery;
  state.productPoolPage = 1;
  switchModule('product-pool');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeProductDrawer();
});

elements.provider.addEventListener('change', applyProviderPreset);
elements['save-ai'].addEventListener('click', saveAiProfile);
elements['toggle-key'].addEventListener('click', () => {
  const show = elements['api-key'].type === 'password';
  elements['api-key'].type = show ? 'text' : 'password';
  elements['toggle-key'].textContent = show ? '隐藏' : '显示';
});
document.querySelectorAll('.secret-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.secretTarget);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '隐藏' : '显示';
  });
});
elements['ali-save'].addEventListener('click', saveAlibabaProfile);
elements['ali-authorize'].addEventListener('click', openAlibabaAuthorization);
elements['ali-exchange'].addEventListener('click', exchangeAlibabaAuthorizationCode);
elements['ali-test'].addEventListener('click', async () => {
  setBusy(elements['ali-test'], true, '正在验证…');
  elements['ali-active-state'].textContent = '验证中';
  setStatus(elements['ali-status'], '正在校验 TOP 签名与店铺授权');
  try {
    const result = await requestJson('/api/alibaba/test', {
      method: 'POST',
      body: JSON.stringify(getAlibabaConfig()),
    });
    elements['ali-active-state'].textContent = result.ok ? '已连接' : '验证失败';
    const trace = result.traceId ? ` · Trace ${result.traceId}` : '';
    setStatus(elements['ali-status'], `${result.message}${trace}`, result.ok ? 'success' : 'error');
    if (result.ok) window.dispatchEvent(new Event('alibaba-config-updated'));
  } catch (error) {
    elements['ali-active-state'].textContent = '验证失败';
    setStatus(elements['ali-status'], error.message, 'error');
  } finally {
    setBusy(elements['ali-test'], false);
  }
});

for (let index = 0; index < 4; index += 1) {
  document.getElementById(`main-image-${index + 1}`).addEventListener('change', (event) => {
    renderMainImageSlot(index, event.target.files[0]);
  });
}
elements['auxiliary-image-pool'].addEventListener('change', (event) => {
  setAuxiliaryImages(event.target.files);
});

elements['word-file'].addEventListener('change', async () => {
  const file = elements['word-file'].files[0];
  if (!file) return;
  try {
    state.wordFileName = file.name;
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const result = await requestJson('/api/keywords/xlsx', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: file,
      });
      state.words = result.words;
    } else {
      state.words = parseWordText(await file.text(), file.name);
    }
    renderKeywords();
    setStatus(elements['action-message'], `已读取 ${state.words.length} 个关键词。`, 'success');
  } catch (error) {
    state.words = [];
    renderKeywords();
    setStatus(elements['action-message'], error.message, 'error');
  }
});

elements.title.addEventListener('input', () => {
  state.currentTaskSaved = false;
  elements['title-count'].textContent = elements.title.value.length;
  if (state.products[state.currentIndex]) state.products[state.currentIndex].manuallyEdited = true;
  syncCurrentProduct();
  renderTabs();
  renderCurrentBatch();
});
elements['selling-points'].addEventListener('input', () => {
  state.currentTaskSaved = false;
  if (state.products[state.currentIndex]) state.products[state.currentIndex].manuallyEdited = true;
  syncCurrentProduct();
  renderCurrentBatch();
});
elements.keywords.addEventListener('input', () => {
  state.currentTaskSaved = false;
  if (state.products[state.currentIndex]) state.products[state.currentIndex].manuallyEdited = true;
  syncCurrentProduct();
  renderCurrentBatch();
});
elements['custom-attribute-rows'].addEventListener('input', () => {
  state.currentTaskSaved = false;
  if (state.products[state.currentIndex]) state.products[state.currentIndex].manuallyEdited = true;
  syncCurrentProduct();
  renderCurrentBatch();
});
elements['faq-rows'].addEventListener('input', () => {
  state.currentTaskSaved = false;
  if (state.products[state.currentIndex]) state.products[state.currentIndex].manuallyEdited = true;
  syncCurrentProduct();
  renderCurrentBatch();
});
elements['add-custom-attribute'].addEventListener('click', () => {
  syncCurrentProduct();
  const product = state.products[state.currentIndex];
  if (!product) return;
  product.customAttributes.push({ name: '', value: '' });
  product.manuallyEdited = true;
  renderEditor();
  elements['custom-attribute-rows'].querySelector('.attribute-row:last-child .attribute-name')?.focus();
});
elements['custom-attribute-rows'].addEventListener('click', (event) => {
  const button = event.target.closest('[data-row-action]');
  if (!button) return;
  syncCurrentProduct();
  const product = state.products[state.currentIndex];
  const row = button.closest('.attribute-row');
  const index = Number(row?.dataset.index);
  if (!product || !Number.isInteger(index)) return;
  if (button.dataset.rowAction === 'delete') product.customAttributes.splice(index, 1);
  if (button.dataset.rowAction === 'up' && index > 0) {
    [product.customAttributes[index - 1], product.customAttributes[index]] = [product.customAttributes[index], product.customAttributes[index - 1]];
  }
  if (button.dataset.rowAction === 'down' && index < product.customAttributes.length - 1) {
    [product.customAttributes[index + 1], product.customAttributes[index]] = [product.customAttributes[index], product.customAttributes[index + 1]];
  }
  product.manuallyEdited = true;
  renderEditor();
});

elements['test-ai'].addEventListener('click', async () => {
  setBusy(elements['test-ai'], true, '正在测试…');
  setStatus(elements['ai-status'], '正在连接模型接口');
  try {
    const result = await requestJson('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(getAiConfig()),
    });
    setStatus(elements['ai-status'], result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    setStatus(elements['ai-status'], error.message, 'error');
  } finally {
    setBusy(elements['test-ai'], false);
  }
});

elements['manual-create'].addEventListener('click', () => createManualProducts(elements['manual-create']));
elements['new-manual-create'].addEventListener('click', () => createManualProducts(elements['new-manual-create']));
elements['load-source-product'].addEventListener('click', loadSourceProduct);
elements['generate-previews'].addEventListener('click', generateProductPreviews);
elements['generate-image-previews'].addEventListener('click', generateImageProductPreviews);
elements['ai-generate-similar'].addEventListener('click', generateSimilarProductsFromTemplate);
elements['upload-photobank'].addEventListener('click', uploadAssignedImagesToPhotobank);

elements['ai-generate'].addEventListener('click', async () => {
  const imageFiles = state.mainImageFiles.filter(Boolean);
  if (!imageFiles.length) {
    setStatus(elements['action-message'], '请先上传至少一张商品主图。', 'error');
    return;
  }
  if (!state.words.length) {
    setStatus(elements['action-message'], '请先在“关键词表”中上传并检查词表。', 'error');
    return;
  }
  const config = getAiConfig();
  if (!config.apiKey || !config.model) {
    setStatus(elements['action-message'], '请先在“AI 接口”中填写 API Key 和模型名称。', 'error');
    return;
  }

  setBusy(elements['ai-generate'], true, 'AI 正在生成…');
  setStatus(elements['action-message'], '正在生成 1 个基础品和 4 个类似品；这一步会产生模型用量。');
  try {
    const result = await requestJson('/api/products/generate', {
      method: 'POST',
      body: JSON.stringify({
        config,
        source: {
          imageNames: imageFiles.map((file) => file.name),
          words: state.words,
          manualFacts: elements['manual-facts'].value.trim(),
        },
      }),
    });
    state.products = result.products.map((product, index) => ({
      ...product,
      customAttributes: [],
      faqItems: Array.from({ length: 5 }, () => ({ question: '', answer: '' })),
      imageAssignment: buildDefaultImageAssignments()[index] || null,
    }));
    state.currentIndex = 0;
    state.mode = 'ai';
    state.sourceTemplate = null;
    state.photobankUploads = {};
    renderEditor();
    setStatus(elements['action-message'], '五个版本已生成，请逐个检查后再保存。', 'success');
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(elements['ai-generate'], false);
  }
});

elements['save-task'].addEventListener('click', async () => {
  syncCurrentProduct();
  setBusy(elements['save-task'], true, '正在保存…');
  try {
    const config = getAiConfig();
    const result = await requestJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        source: {
          mainImageNames: state.mainImageFiles.filter(Boolean).map((file) => file.name),
          auxiliaryImageNames: state.auxiliaryImageFiles.map((file) => file.name),
          imageAssignments: state.products.map((product) => product.imageAssignment || null),
          wordFileName: state.wordFileName,
          words: state.words,
          manualFacts: elements['manual-facts'].value.trim(),
          sourceProductId: state.sourceTemplate?.sourceProductId || '',
          schemaXml: state.sourceTemplate?.schemaXml || '',
          photobankUploads: state.photobankUploads,
        },
        products: state.products,
        generation: { mode: state.mode, provider: config.provider, baseUrl: config.baseUrl, model: config.model },
      }),
    });
    setStatus(elements['action-message'], `任务 ${result.id} 已保存到本机。`, 'success');
    state.currentTaskSaved = true;
    renderWorkflowStages();
    elements['top-last-saved'].textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    elements['top-batch-state'].textContent = result.id;
    await loadProductPool();
  } catch (error) {
    setStatus(elements['action-message'], error.message, 'error');
  } finally {
    setBusy(elements['save-task'], false);
  }
});

restoreAiProfile();
restoreAlibabaProfile();
initObsidianPublishing({
  requestJson,
  getAlibabaConfig,
  getPhotobankGroupId: () => elements['ali-photobank-group'].value.trim(),
});
init1688Publishing({ requestJson });
renderKeywords();
renderEditor();
loadProductPool();
new MutationObserver(() => {
  elements['top-alibaba-state'].textContent = elements['ali-active-state'].textContent;
}).observe(elements['ali-active-state'], { childList: true, characterData: true, subtree: true });
elements['top-alibaba-state'].textContent = elements['ali-active-state'].textContent;
