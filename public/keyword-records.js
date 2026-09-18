export function parseKeywordLines(text) {
  const seen = new Set();
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function includesQuery(...values) {
  const query = String(values.pop() ?? '').trim().toLocaleLowerCase();
  if (!query) return true;
  return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
}

export function filterProducts(products, query) {
  return products.filter((item) => includesQuery(item.product_id, query));
}

export function filterInquiryKeywords(items, query) {
  return items.filter((item) => includesQuery(item.keyword, item.note, query));
}

export function filterBlockedKeywords(items, keywordQuery, productId) {
  const selectedProductId = String(productId ?? '').trim();
  return items.filter((item) => (
    includesQuery(item.keyword, item.note, keywordQuery)
    && (!selectedProductId || item.product_id === selectedProductId)
  ));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function createActionButton(label, action, id, className = 'button quiet compact-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

export function initKeywordRecords({ requestJson }) {
  const root = document.getElementById('module-keyword-records');
  if (!root) return { load: async () => undefined };

  const byId = (id) => root.querySelector(`#${id}`);
  const elements = {
    status: byId('keyword-record-status'),
    productSearch: byId('keyword-product-search'),
    productInput: byId('keyword-product-id'),
    productAdd: byId('keyword-product-add'),
    productList: byId('keyword-product-list'),
    selectedProduct: byId('keyword-selected-product'),
    inquirySearch: byId('keyword-inquiry-search'),
    inquiryAdd: byId('keyword-inquiry-add'),
    inquiryBatch: byId('keyword-inquiry-batch'),
    inquiryBody: byId('keyword-inquiry-body'),
    inquiryEmpty: byId('keyword-inquiry-empty'),
    blockedSearch: byId('keyword-blocked-search'),
    blockedProductFilter: byId('keyword-blocked-product-filter'),
    blockedAdd: byId('keyword-blocked-add'),
    blockedBatch: byId('keyword-blocked-batch'),
    blockedBody: byId('keyword-blocked-body'),
    blockedEmpty: byId('keyword-blocked-empty'),
    recordDialog: byId('keyword-record-dialog'),
    recordForm: byId('keyword-record-form'),
    recordTitle: byId('keyword-record-dialog-title'),
    recordProductField: byId('keyword-record-product-field'),
    recordProductId: byId('keyword-record-product-id'),
    recordKeyword: byId('keyword-record-keyword'),
    recordNote: byId('keyword-record-note'),
    recordCancel: byId('keyword-record-cancel'),
    batchDialog: byId('keyword-batch-dialog'),
    batchForm: byId('keyword-batch-form'),
    batchTitle: byId('keyword-batch-dialog-title'),
    batchProductField: byId('keyword-batch-product-field'),
    batchProductId: byId('keyword-batch-product-id'),
    batchKeywords: byId('keyword-batch-keywords'),
    batchCancel: byId('keyword-batch-cancel'),
  };
  const views = [...root.querySelectorAll('[data-keyword-view]')];
  const tabs = [...root.querySelectorAll('[data-keyword-tab]')];
  let initialized = false;
  let loaded = false;
  let activeView = 'inquiry';
  let selectedProductId = '';
  let data = { products: [], inquiry_keywords: [], blocked_keywords: [] };

  function setStatus(message, type = '') {
    elements.status.textContent = message;
    elements.status.classList.toggle('success', type === 'success');
    elements.status.classList.toggle('error', type === 'error');
  }

  function setData(nextData) {
    data = nextData;
    if (selectedProductId && !data.products.some((item) => item.product_id === selectedProductId)) {
      selectedProductId = '';
    }
    if (!selectedProductId && data.products.length) selectedProductId = data.products[0].product_id;
    render();
  }

  function renderProducts() {
    const products = filterProducts(data.products, elements.productSearch.value);
    elements.productList.replaceChildren();
    for (const product of products) {
      const row = document.createElement('div');
      row.className = 'keyword-product-row';
      if (product.product_id === selectedProductId) row.classList.add('active');
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'keyword-product-select';
      select.dataset.action = 'select-product';
      select.dataset.productId = product.product_id;
      const id = document.createElement('strong');
      id.textContent = product.product_id;
      const count = document.createElement('span');
      const total = data.inquiry_keywords.filter((item) => item.product_id === product.product_id).length;
      count.textContent = `${total} 个词`;
      select.append(id, count);
      const remove = createActionButton('删除', 'delete-product', product.id, 'keyword-row-delete');
      row.append(select, remove);
      elements.productList.append(row);
    }
    if (!products.length) {
      const empty = document.createElement('p');
      empty.className = 'keyword-inline-empty';
      empty.textContent = data.products.length ? '没有匹配的 Product ID' : '还没有 Product ID';
      elements.productList.append(empty);
    }
    elements.selectedProduct.textContent = selectedProductId || '尚未选择';
    elements.inquiryAdd.disabled = !selectedProductId;
    elements.inquiryBatch.disabled = !selectedProductId;
  }

  function appendKeywordRow(body, record, type) {
    const row = document.createElement('tr');
    const keyword = document.createElement('td');
    keyword.textContent = record.keyword;
    const product = document.createElement('td');
    product.textContent = record.product_id || '—';
    const note = document.createElement('td');
    note.textContent = record.note || '—';
    const created = document.createElement('td');
    created.textContent = formatDate(record.created_at);
    const actions = document.createElement('td');
    actions.className = 'keyword-row-actions';
    actions.append(
      createActionButton('编辑', `edit-${type}`, record.id),
      createActionButton('删除', `delete-${type}`, record.id),
    );
    if (type === 'inquiry') row.append(keyword, note, created, actions);
    else row.append(keyword, product, note, created, actions);
    body.append(row);
  }

  function renderInquiry() {
    const items = filterInquiryKeywords(
      data.inquiry_keywords.filter((item) => item.product_id === selectedProductId),
      elements.inquirySearch.value,
    );
    elements.inquiryBody.replaceChildren();
    items.forEach((item) => appendKeywordRow(elements.inquiryBody, item, 'inquiry'));
    elements.inquiryEmpty.hidden = items.length > 0;
    elements.inquiryEmpty.textContent = selectedProductId
      ? '这个 Product ID 还没有询盘词'
      : '请先在左侧新增并选择 Product ID';
  }

  function renderBlockedFilters() {
    const current = elements.blockedProductFilter.value;
    elements.blockedProductFilter.replaceChildren(new Option('全部 Product ID', ''));
    for (const product of data.products) {
      elements.blockedProductFilter.append(new Option(product.product_id, product.product_id));
    }
    if ([...elements.blockedProductFilter.options].some((option) => option.value === current)) {
      elements.blockedProductFilter.value = current;
    }
  }

  function renderBlocked() {
    const items = filterBlockedKeywords(
      data.blocked_keywords,
      elements.blockedSearch.value,
      elements.blockedProductFilter.value,
    );
    elements.blockedBody.replaceChildren();
    items.forEach((item) => appendKeywordRow(elements.blockedBody, item, 'blocked'));
    elements.blockedEmpty.hidden = items.length > 0;
  }

  function render() {
    tabs.forEach((tab) => {
      const active = tab.dataset.keywordTab === activeView;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    views.forEach((view) => { view.hidden = view.dataset.keywordView !== activeView; });
    renderProducts();
    renderInquiry();
    renderBlockedFilters();
    renderBlocked();
  }

  function openRecordDialog(type, record = null) {
    elements.recordForm.dataset.type = type;
    elements.recordForm.dataset.id = record?.id || '';
    const blocked = type === 'blocked';
    elements.recordTitle.textContent = `${record ? '编辑' : '新增'}${blocked ? '屏蔽词' : '询盘词'}`;
    elements.recordProductField.hidden = !blocked;
    elements.recordProductId.value = record?.product_id || '';
    elements.recordKeyword.value = record?.keyword || '';
    elements.recordNote.value = record?.note || '';
    elements.recordDialog.showModal();
    elements.recordKeyword.focus();
  }

  function openBatchDialog(type) {
    elements.batchForm.dataset.type = type;
    const blocked = type === 'blocked';
    elements.batchTitle.textContent = blocked ? '批量添加屏蔽词' : '批量添加询盘词';
    elements.batchProductField.hidden = !blocked;
    elements.batchProductId.value = '';
    elements.batchKeywords.value = '';
    elements.batchDialog.showModal();
    elements.batchKeywords.focus();
  }

  async function handleMutation(work, successMessage) {
    try {
      setStatus('正在保存…');
      const result = await work();
      setData(result.data || result);
      setStatus(successMessage(result), 'success');
      return true;
    } catch (error) {
      setStatus(error.message, 'error');
      return false;
    }
  }

  function findRecord(type, id) {
    const records = type === 'inquiry' ? data.inquiry_keywords : data.blocked_keywords;
    return records.find((item) => item.id === id);
  }

  function bindEvents() {
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      activeView = tab.dataset.keywordTab;
      render();
    }));
    elements.productSearch.addEventListener('input', renderProducts);
    elements.inquirySearch.addEventListener('input', renderInquiry);
    elements.blockedSearch.addEventListener('input', renderBlocked);
    elements.blockedProductFilter.addEventListener('change', renderBlocked);

    elements.productAdd.addEventListener('click', async () => {
      const productId = elements.productInput.value;
      const saved = await handleMutation(
        () => requestJson('/api/keyword-records/products', {
          method: 'POST', body: JSON.stringify({ product_id: productId }),
        }),
        () => 'Product ID 已添加',
      );
      if (saved) {
        selectedProductId = productId.trim();
        elements.productInput.value = '';
        render();
      }
    });
    elements.productInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') elements.productAdd.click();
    });

    elements.productList.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'select-product') {
        selectedProductId = action.dataset.productId;
        render();
        return;
      }
      if (action.dataset.action === 'delete-product'
        && window.confirm('删除这个 Product ID 及其全部询盘词？直通车屏蔽词不会删除。')) {
        await handleMutation(
          () => requestJson(`/api/keyword-records/products/${encodeURIComponent(action.dataset.id)}`, { method: 'DELETE' }),
          () => 'Product ID 已删除',
        );
      }
    });

    elements.inquiryAdd.addEventListener('click', () => openRecordDialog('inquiry'));
    elements.inquiryBatch.addEventListener('click', () => openBatchDialog('inquiry'));
    elements.blockedAdd.addEventListener('click', () => openRecordDialog('blocked'));
    elements.blockedBatch.addEventListener('click', () => openBatchDialog('blocked'));

    root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action || !/^(edit|delete)-(inquiry|blocked)$/.test(action.dataset.action)) return;
      const [, operation, type] = action.dataset.action.match(/^(edit|delete)-(inquiry|blocked)$/);
      const record = findRecord(type, action.dataset.id);
      if (!record) return;
      if (operation === 'edit') {
        openRecordDialog(type, record);
        return;
      }
      if (!window.confirm(`删除关键词“${record.keyword}”？`)) return;
      await handleMutation(
        () => requestJson(`/api/keyword-records/${type}/${encodeURIComponent(record.id)}`, { method: 'DELETE' }),
        () => '关键词已删除',
      );
    });

    elements.recordCancel.addEventListener('click', () => elements.recordDialog.close());
    elements.batchCancel.addEventListener('click', () => elements.batchDialog.close());
    elements.recordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const type = elements.recordForm.dataset.type;
      const id = elements.recordForm.dataset.id;
      const body = {
        product_id: type === 'inquiry' ? selectedProductId : elements.recordProductId.value,
        keyword: elements.recordKeyword.value,
        note: elements.recordNote.value,
      };
      const saved = await handleMutation(
        () => requestJson(`/api/keyword-records/${type}${id ? `/${encodeURIComponent(id)}` : ''}`, {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body),
        }),
        () => id ? '关键词已更新' : '关键词已添加',
      );
      if (saved) elements.recordDialog.close();
    });
    elements.batchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const type = elements.batchForm.dataset.type;
      const body = {
        product_id: type === 'inquiry' ? selectedProductId : elements.batchProductId.value,
        keywords: elements.batchKeywords.value,
      };
      const saved = await handleMutation(
        () => requestJson(`/api/keyword-records/${type}/batch`, {
          method: 'POST', body: JSON.stringify(body),
        }),
        (result) => `成功新增 ${result.added} 个，跳过重复 ${result.skipped} 个`,
      );
      if (saved) elements.batchDialog.close();
    });
  }

  async function load() {
    if (loaded) return;
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    try {
      setStatus('正在读取本地记录…');
      setData(await requestJson('/api/keyword-records'));
      loaded = true;
      setStatus('记录已从本机载入', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  return { load };
}
