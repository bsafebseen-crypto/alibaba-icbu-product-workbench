export function createObsidianPublishingState() {
  return {
    batches: [],
    batch: null,
    basePlanId: '',
    sourceProductId: '',
    loading: false,
    error: '',
  };
}

export function remainingPlans(batch, basePlanId) {
  if (!batch?.plans?.some((plan) => plan.id === basePlanId)) {
    throw new Error('请选择批次中的一个母商品方案');
  }
  return batch.plans.filter((plan) => plan.id !== basePlanId);
}

function text(element, value) {
  if (element) element.textContent = value;
}

export function initObsidianPublishing({ requestJson, documentRef = globalThis.document } = {}) {
  const section = documentRef?.getElementById('module-obsidian-publishing');
  if (!section) return null;

  const state = createObsidianPublishingState();
  const elements = {
    refresh: documentRef.getElementById('obsidian-refresh'),
    select: documentRef.getElementById('obsidian-file-select'),
    load: documentRef.getElementById('obsidian-load'),
    status: documentRef.getElementById('obsidian-status'),
    summary: documentRef.getElementById('obsidian-batch-summary'),
    plans: documentRef.getElementById('obsidian-plan-list'),
    sourceProductId: documentRef.getElementById('obsidian-source-product-id'),
    remaining: documentRef.getElementById('obsidian-remaining-summary'),
  };

  function setStatus(message, kind = '') {
    text(elements.status, message);
    elements.status.dataset.kind = kind;
  }

  function renderBatchList() {
    elements.select.replaceChildren();
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.batches.length ? '请选择一个 Markdown 批次' : '没有找到 Markdown 文件';
    elements.select.append(placeholder);
    for (const batch of state.batches) {
      const option = documentRef.createElement('option');
      option.value = batch.relativePath;
      option.disabled = !batch.valid;
      option.textContent = batch.valid
        ? `${batch.batchName} · ${batch.relativePath}`
        : `无效：${batch.relativePath} · ${batch.error}`;
      elements.select.append(option);
    }
    elements.load.disabled = true;
  }

  function renderPlans() {
    elements.plans.replaceChildren();
    if (!state.batch) {
      text(elements.summary, '尚未载入批次');
      text(elements.remaining, '选择母商品方案后，这里会显示剩余 4 个类似品。');
      return;
    }
    text(elements.summary, `${state.batch.batchName} · 5 套方案 · 格式版本 ${state.batch.schemaVersion}`);
    for (const [index, plan] of state.batch.plans.entries()) {
      const label = documentRef.createElement('label');
      label.className = 'obsidian-plan-option';
      const radio = documentRef.createElement('input');
      radio.type = 'radio';
      radio.name = 'obsidian-base-plan';
      radio.value = plan.id;
      const copy = documentRef.createElement('span');
      const title = documentRef.createElement('strong');
      title.textContent = `方案 ${index + 1} · ${plan.title}`;
      const detail = documentRef.createElement('small');
      detail.textContent = `5 条 FAQ · 10 条自定义属性 · ID ${plan.id}`;
      copy.append(title, detail);
      label.append(radio, copy);
      elements.plans.append(label);
    }
  }

  async function refreshBatches() {
    state.loading = true;
    elements.refresh.disabled = true;
    setStatus('正在读取 Obsidian 发品目录…');
    try {
      const result = await requestJson('/api/obsidian/batches');
      state.batches = result.batches;
      renderBatchList();
      setStatus(`已找到 ${state.batches.length} 个 Markdown 文件。`, 'success');
    } catch (error) {
      state.error = error.message;
      setStatus(error.message, 'error');
    } finally {
      state.loading = false;
      elements.refresh.disabled = false;
    }
  }

  elements.select.addEventListener('change', () => {
    elements.load.disabled = !elements.select.value;
  });
  elements.refresh.addEventListener('click', refreshBatches);
  elements.load.addEventListener('click', async () => {
    if (!elements.select.value) return;
    elements.load.disabled = true;
    setStatus('正在校验五套方案…');
    try {
      state.batch = await requestJson('/api/obsidian/batch', {
        method: 'POST',
        body: JSON.stringify({ relativePath: elements.select.value }),
      });
      state.basePlanId = '';
      renderPlans();
      setStatus('批次校验通过。请选择已经手动发布的母商品方案。', 'success');
    } catch (error) {
      state.error = error.message;
      setStatus(error.message, 'error');
    } finally {
      elements.load.disabled = false;
    }
  });
  elements.plans.addEventListener('change', (event) => {
    if (event.target.name !== 'obsidian-base-plan') return;
    state.basePlanId = event.target.value;
    const variants = remainingPlans(state.batch, state.basePlanId);
    text(elements.remaining, `已排除母商品；将准备 ${variants.map((plan) => plan.id).join('、')} 共 4 个类似品。`);
  });
  elements.sourceProductId.addEventListener('input', () => {
    state.sourceProductId = elements.sourceProductId.value.trim();
  });

  renderBatchList();
  renderPlans();
  return { state, refreshBatches };
}
