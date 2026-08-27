import { assignSharedProductImages } from './shared-image-assignment.js';

export function createObsidianPublishingState() {
  return {
    batches: [],
    batch: null,
    basePlanId: '',
    sourceProductId: '',
    sourceContext: null,
    sellingPointDiagnosis: null,
    sellingPointBinding: null,
    variants: [],
    mainImages: [null, null, null, null],
    marketingImages: [],
    fixedImages: [],
    filesByPlan: {},
    uploads: {},
    previews: [],
    sessionId: '',
    taskId: '',
    draftItems: {},
    savedDrafts: [],
    loading: false,
    error: '',
  };
}

export function imageFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function imageContentKey(file, cryptoRef = globalThis.crypto) {
  const digest = await cryptoRef.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function buildSharedImageAssignments(state) {
  return assignSharedProductImages({
    variants: state.variants,
    mainImages: state.mainImages,
    marketingImages: state.marketingImages,
    fixedImages: state.fixedImages,
  });
}

export function uniqueAssignmentImages(assignments = []) {
  return [...new Map(assignments
    .flatMap((assignment) => assignment.files || [])
    .map((image) => [image.sha256, image])).values()];
}

export function commonSellingPointCandidate(diagnosis = {}) {
  const sourceCandidates = Array.isArray(diagnosis.sourceCandidates)
    ? diagnosis.sourceCandidates
    : [];
  const draftCandidates = Array.isArray(diagnosis.draftCandidates)
    ? diagnosis.draftCandidates
    : [];
  const matches = sourceCandidates.flatMap((source) => {
    if (source.structureType !== 'single-text' || source.carrierPaths?.length !== 1) return [];
    const path = source.carrierPaths[0];
    const matchingDrafts = draftCandidates.filter((draft) => (
      draft.fieldId === source.fieldId
      && draft.structureType === 'single-text'
      && JSON.stringify(draft.carrierPaths) === JSON.stringify([path])
    ));
    return matchingDrafts.length === 1 ? [{
      fieldId: source.fieldId,
      carrierPath: [...path],
      structureType: 'single-text',
    }] : [];
  });
  if (matches.length !== 1) throw new Error('无法唯一确认卖点字段');
  return matches[0];
}

export function resolveUploadedImages(variants, filesByPlan, uploads) {
  return Object.fromEntries(variants.map((variant) => {
    const files = filesByPlan[variant.id] || [];
    if (files.length !== 6) throw new Error(`${variant.id} 必须选择 6 张图片`);
    const images = files.map((file) => {
      const upload = uploads[imageFileKey(file)];
      if (!upload) throw new Error(`${file.name} 尚未上传到图片银行`);
      return { fileId: upload.fileId, url: upload.photobankUrl };
    });
    return [variant.id, images];
  }));
}

export function resolveSharedUploadedImages(assignments, uploads) {
  return Object.fromEntries(assignments.map((assignment) => [
    assignment.planId,
    assignment.files.map((image) => {
      const upload = uploads[image.sha256];
      if (!upload?.fileId || !upload?.photobankUrl) {
        throw new Error(`${image.fileName} 尚未上传到图片银行`);
      }
      return { fileId: upload.fileId, url: upload.photobankUrl };
    }),
  ]));
}

export function invalidatePreviewState(state) {
  state.previews = [];
  state.sessionId = '';
  state.taskId = '';
  state.draftItems = {};
}

export function remainingPlans(batch, basePlanId) {
  if (!batch?.plans?.some((plan) => plan.id === basePlanId)) {
    throw new Error('请选择批次中的一个母商品方案');
  }
  return batch.plans.filter((plan) => plan.id !== basePlanId);
}

export function formatDraftVerification(result = {}) {
  const trace = result.traceId ? `追踪号 ${result.traceId}` : '无追踪号';
  if (result.comparison?.exactMatch) {
    const orderNote = result.comparison?.fields?.customAttributes?.orderChanged
      ? '阿里调整了属性顺序，名称和值一致。'
      : '';
    return `核对一致：标题、卖点、5 条 FAQ、10 条属性和 6 张图片信息均完整。${orderNote}${trace}`;
  }
  const labels = {
    title: '标题', sellingPoints: '卖点', faqs: 'FAQ', customAttributes: '属性', images: '图片',
  };
  const differences = (result.comparison?.differences || []).map((name) => labels[name] || name);
  const attributeDetails = result.comparison?.fields?.customAttributes?.details;
  const attributeMessages = attributeDetails ? [
    ...(!attributeDetails.orderMatch ? ['顺序不同'] : []),
    ...(attributeDetails.changed || []).map((item) => (
      `${item.name}：期望“${item.expectedValue}”，草稿“${item.actualValue}”`
    )),
    ...(attributeDetails.missing || []).map((item) => `缺少 ${item.name}=${item.value}`),
    ...(attributeDetails.unexpected || []).map((item) => `多出 ${item.name}=${item.value}`),
  ] : [];
  const detail = attributeMessages.length ? `属性明细：${attributeMessages.join('；')}。` : '';
  return `发现差异：${differences.join('、') || '无法识别字段'}。${detail}${trace}`;
}

export function buildPreviewRequest(state, imagesByPlan) {
  return {
    relativePath: state.batch.source.relativePath,
    basePlanId: state.basePlanId,
    sourceContext: state.sourceContext,
    imagesByPlan,
  };
}

function text(element, value) {
  if (element) element.textContent = value;
}

export function initObsidianPublishing({
  requestJson,
  getAlibabaConfig = () => ({}),
  getPhotobankGroupId = () => '',
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
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
    loadSource: documentRef.getElementById('obsidian-load-source'),
    sourceStatus: documentRef.getElementById('obsidian-source-status'),
    diagnosticDraftId: documentRef.getElementById('obsidian-diagnostic-draft-id'),
    diagnoseSellingPoints: documentRef.getElementById('obsidian-diagnose-selling-points'),
    confirmSellingPoint: documentRef.getElementById('obsidian-confirm-selling-point'),
    sellingPointStatus: documentRef.getElementById('obsidian-selling-point-status'),
    mainImageInputs: Array.from({ length: 4 }, (_, index) => (
      documentRef.getElementById(`obsidian-main-image-${index + 1}`)
    )),
    marketingImages: documentRef.getElementById('obsidian-marketing-images'),
    fixedImagePaths: [
      documentRef.getElementById('obsidian-fixed-image-1'),
      documentRef.getElementById('obsidian-fixed-image-2'),
    ],
    saveFixedImages: documentRef.getElementById('obsidian-save-fixed-images'),
    fixedImageStatus: documentRef.getElementById('obsidian-fixed-image-status'),
    assignmentSummary: documentRef.getElementById('obsidian-assignment-summary'),
    variants: documentRef.getElementById('obsidian-variant-list'),
    uploadImages: documentRef.getElementById('obsidian-upload-images'),
    generatePreviews: documentRef.getElementById('obsidian-generate-previews'),
    previewStatus: documentRef.getElementById('obsidian-preview-status'),
    draftStatus: documentRef.getElementById('obsidian-draft-status'),
    savedDrafts: documentRef.getElementById('obsidian-saved-drafts'),
  };

  function setStatus(message, kind = '') {
    text(elements.status, message);
    elements.status.dataset.kind = kind;
  }

  function setPreviewStatus(message, kind = '') {
    text(elements.previewStatus, message);
    elements.previewStatus.dataset.kind = kind;
  }

  function invalidatePreparedData() {
    state.sourceContext = null;
    state.sellingPointDiagnosis = null;
    state.sellingPointBinding = null;
    state.variants = [];
    state.mainImages = [null, null, null, null];
    state.marketingImages = [];
    state.filesByPlan = {};
    state.uploads = {};
    invalidatePreviewState(state);
    elements.uploadImages.disabled = true;
    elements.generatePreviews.disabled = true;
    elements.diagnoseSellingPoints.disabled = true;
    elements.confirmSellingPoint.disabled = true;
    elements.variants.innerHTML = '<p>载入母商品 Schema 后显示剩余四套方案。</p>';
    setPreviewStatus('尚未准备图片。');
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

  function renderSavedDrafts() {
    elements.savedDrafts.replaceChildren();
    if (!state.savedDrafts.length) {
      const empty = documentRef.createElement('p');
      empty.textContent = '本机还没有已创建的商品草稿。';
      elements.savedDrafts.append(empty);
      return;
    }
    for (const draft of state.savedDrafts) {
      const row = documentRef.createElement('article');
      row.className = 'obsidian-saved-draft';
      const copy = documentRef.createElement('div');
      const title = documentRef.createElement('strong');
      title.textContent = `${draft.planId} · 草稿 ID ${draft.draftProductId}`;
      const detail = documentRef.createElement('small');
      detail.textContent = draft.relativePath;
      copy.append(title, detail);
      const button = documentRef.createElement('button');
      button.className = 'button quiet obsidian-draft-verify-button';
      button.type = 'button';
      button.dataset.taskId = draft.taskId;
      button.dataset.planId = draft.planId;
      button.textContent = '读取并核对草稿';
      const result = documentRef.createElement('p');
      result.className = 'obsidian-draft-verify-result';
      result.setAttribute('role', 'status');
      row.append(copy, button, result);
      elements.savedDrafts.append(row);
    }
  }

  async function refreshSavedDrafts() {
    try {
      const result = await requestJson('/api/obsidian/drafts');
      state.savedDrafts = result.drafts || [];
      renderSavedDrafts();
    } catch (error) {
      const message = documentRef.createElement('p');
      message.textContent = error.message;
      elements.savedDrafts.replaceChildren(message);
    }
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

  function renderVariants() {
    elements.variants.replaceChildren();
    for (const [index, variant] of state.variants.entries()) {
      const card = documentRef.createElement('article');
      card.className = 'obsidian-variant-card';
      card.dataset.planId = variant.id;
      const heading = documentRef.createElement('div');
      heading.className = 'obsidian-variant-heading';
      const copy = documentRef.createElement('div');
      const title = documentRef.createElement('strong');
      title.textContent = `类似品 ${index + 1} · ${variant.title}`;
      const detail = documentRef.createElement('small');
      detail.textContent = `${variant.id} · 5 FAQ · 10 自定义属性`;
      copy.append(title, detail);
      const status = documentRef.createElement('span');
      status.className = 'obsidian-variant-status';
      status.textContent = '待准备共享图片';
      heading.append(copy, status);

      const content = documentRef.createElement('details');
      const summary = documentRef.createElement('summary');
      summary.textContent = '查看将替换的 Listing 内容';
      const description = documentRef.createElement('p');
      description.textContent = variant.sellingPoints;
      content.append(summary, description);
      const draftButton = documentRef.createElement('button');
      draftButton.className = 'button obsidian-draft-button';
      draftButton.type = 'button';
      draftButton.dataset.planId = variant.id;
      draftButton.textContent = '确认并创建此商品草稿';
      draftButton.disabled = true;
      card.append(heading, content, draftButton);
      elements.variants.append(card);
    }
  }

  function invalidateSharedImagePreview(message = '共享图片已经变化，请重新生成完整预览。') {
    invalidatePreviewState(state);
    elements.generatePreviews.disabled = true;
    elements.variants.querySelectorAll('.obsidian-draft-button').forEach((button) => {
      button.disabled = true;
      button.textContent = '请重新生成完整预览';
    });
    text(elements.draftStatus, message);
  }

  function renderSharedAssignments() {
    elements.assignmentSummary.replaceChildren();
    try {
      const assignments = buildSharedImageAssignments(state);
      for (const assignment of assignments) {
        const row = documentRef.createElement('div');
        row.className = 'obsidian-assignment-row';
        const title = documentRef.createElement('strong');
        title.textContent = assignment.planId;
        const names = documentRef.createElement('span');
        names.textContent = assignment.files.map((image) => image.fileName).join(' → ');
        row.append(title, names);
        elements.assignmentSummary.append(row);
        const card = elements.variants.querySelector(`[data-plan-id="${CSS.escape(assignment.planId)}"]`);
        text(card?.querySelector('.obsidian-variant-status'), '6 张图片已自动分配');
      }
      elements.uploadImages.disabled = false;
      setPreviewStatus('四套图片已自动分配；上传前会先检查本机图片银行缓存。');
      return assignments;
    } catch (error) {
      const message = documentRef.createElement('p');
      message.textContent = error.message;
      elements.assignmentSummary.append(message);
      elements.uploadImages.disabled = true;
      setPreviewStatus(error.message);
      return [];
    }
  }

  async function describeBrowserFile(file) {
    return {
      sha256: await imageContentKey(file),
      fileName: file.name,
      size: file.size,
      mimeType: file.type,
      file,
    };
  }

  async function loadFixedImages() {
    try {
      const result = await requestJson('/api/obsidian/fixed-images');
      state.fixedImages = (result.slots || []).filter((slot) => slot.ready);
      result.slots?.forEach((slot, index) => {
        if (elements.fixedImagePaths[index]) elements.fixedImagePaths[index].value = slot.filePath || '';
      });
      text(
        elements.fixedImageStatus,
        state.fixedImages.length === 2 ? '两张固定副图已就绪。' : '固定图不存在或内容已变化，请重新确认。',
      );
      renderSharedAssignments();
    } catch (error) {
      state.fixedImages = [];
      text(elements.fixedImageStatus, error.message);
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
      await refreshSavedDrafts();
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
      invalidatePreparedData();
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
    invalidatePreparedData();
    text(elements.remaining, `已排除母商品；将准备 ${variants.map((plan) => plan.id).join('、')} 共 4 个类似品。`);
  });
  elements.sourceProductId.addEventListener('input', () => {
    state.sourceProductId = elements.sourceProductId.value.trim();
  });
  elements.loadSource.addEventListener('click', async () => {
    state.sourceProductId = elements.sourceProductId.value.trim();
    if (!state.batch || !state.basePlanId) {
      text(elements.sourceStatus, '请先载入批次并选择母商品方案。');
      return;
    }
    if (!/^\d+$/.test(state.sourceProductId)) {
      text(elements.sourceStatus, '母商品 ID 必须是数字。');
      return;
    }
    elements.loadSource.disabled = true;
    text(elements.sourceStatus, '正在读取商品详情、真实类目和发布 Schema…');
    try {
      state.sourceContext = await requestJson('/api/obsidian/source-product', {
        method: 'POST',
        body: JSON.stringify({ config: getAlibabaConfig(), productId: state.sourceProductId }),
      });
      state.variants = remainingPlans(state.batch, state.basePlanId);
      state.filesByPlan = {};
      state.uploads = {};
      invalidatePreviewState(state);
      renderVariants();
      const latestDraft = state.savedDrafts.find((draft) => (
        draft.relativePath === state.batch.source.relativePath
      ));
      if (latestDraft && !elements.diagnosticDraftId.value) {
        elements.diagnosticDraftId.value = latestDraft.draftProductId;
      }
      elements.diagnoseSellingPoints.disabled = false;
      text(
        elements.sourceStatus,
        `已读取类目 ${state.sourceContext.categoryId} · ${state.sourceContext.sourceProductType} · ${state.sourceContext.language}；未修改商品。`,
      );
      renderSharedAssignments();
    } catch (error) {
      state.error = error.message;
      text(elements.sourceStatus, error.message);
    } finally {
      elements.loadSource.disabled = false;
    }
  });
  elements.diagnoseSellingPoints.addEventListener('click', async () => {
    const draftProductId = elements.diagnosticDraftId.value.trim();
    if (!state.sourceContext || !/^\d+$/.test(draftProductId)) {
      text(elements.sellingPointStatus, '请先读取母商品并填写已有草稿 ID。');
      return;
    }
    elements.diagnoseSellingPoints.disabled = true;
    elements.confirmSellingPoint.disabled = true;
    text(elements.sellingPointStatus, '正在只读比较母商品与草稿的卖点字段…');
    try {
      state.sellingPointDiagnosis = await requestJson('/api/obsidian/selling-points/diagnose', {
        method: 'POST',
        body: JSON.stringify({
          config: getAlibabaConfig(),
          sourceProductId: state.sourceProductId,
          draftProductId,
        }),
      });
      const candidate = commonSellingPointCandidate(state.sellingPointDiagnosis);
      state.sellingPointBinding = candidate;
      elements.confirmSellingPoint.disabled = false;
      text(
        elements.sellingPointStatus,
        `候选字段 ${candidate.fieldId} · ${candidate.structureType}；确认前仍禁止生成草稿。`,
      );
    } catch (error) {
      state.sellingPointDiagnosis = null;
      state.sellingPointBinding = null;
      text(elements.sellingPointStatus, error.message);
    } finally {
      elements.diagnoseSellingPoints.disabled = false;
    }
  });
  elements.confirmSellingPoint.addEventListener('click', async () => {
    const binding = state.sellingPointBinding;
    if (!binding || !windowRef.confirm(
      `确认将字段 ${binding?.fieldId || ''} 作为当前类目和 Schema 版本的真实卖点字段？\n\n此操作只保存本机字段映射，不修改商品。`,
    )) return;
    elements.confirmSellingPoint.disabled = true;
    try {
      const result = await requestJson('/api/obsidian/selling-points/binding', {
        method: 'POST',
        body: JSON.stringify({
          config: getAlibabaConfig(),
          sourceProductId: state.sourceProductId,
          binding,
          confirmed: true,
        }),
      });
      state.sellingPointBinding = result.binding;
      text(
        elements.sellingPointStatus,
        `卖点字段已确认：${result.binding.fieldId} · ${result.binding.structureType}`,
      );
    } catch (error) {
      text(elements.sellingPointStatus, error.message);
      elements.confirmSellingPoint.disabled = false;
    }
  });
  elements.mainImageInputs.forEach((input, index) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      state.mainImages[index] = file ? await describeBrowserFile(file) : null;
      invalidateSharedImagePreview();
      renderSharedAssignments();
    });
  });

  elements.marketingImages.addEventListener('change', async () => {
    state.marketingImages = await Promise.all(
      [...(elements.marketingImages.files || [])].map(describeBrowserFile),
    );
    invalidateSharedImagePreview();
    renderSharedAssignments();
  });

  elements.saveFixedImages.addEventListener('click', async () => {
    const paths = elements.fixedImagePaths.map((input) => input.value.trim());
    if (paths.some((filePath) => !filePath)) {
      text(elements.fixedImageStatus, '请填写两张固定副图的完整本机路径。');
      return;
    }
    if (!windowRef.confirm('确认保存这两张固定副图的本机路径和内容指纹？\n\n此操作只写入本机配置，不上传图片、不修改商品。')) return;
    elements.saveFixedImages.disabled = true;
    try {
      const result = await requestJson('/api/obsidian/fixed-images', {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          slots: [
            { name: '通用图', filePath: paths[0] },
            { name: '证书图', filePath: paths[1] },
          ],
        }),
      });
      state.fixedImages = result.slots.filter((slot) => slot.ready);
      invalidateSharedImagePreview('固定副图已经更新，请重新生成完整预览。');
      renderSharedAssignments();
      text(elements.fixedImageStatus, '两张固定副图已保存并校验，后续批次会自动复用。');
    } catch (error) {
      text(elements.fixedImageStatus, error.message);
    } finally {
      elements.saveFixedImages.disabled = false;
    }
  });
  elements.uploadImages.addEventListener('click', async () => {
    let assignments;
    try {
      assignments = buildSharedImageAssignments(state);
    } catch (error) {
      setPreviewStatus(error.message, 'error');
      return;
    }
    const unique = uniqueAssignmentImages(assignments);
    try {
      const cached = await requestJson('/api/alibaba/photobank/cache/resolve', {
        method: 'POST',
        body: JSON.stringify({ images: unique.map(({ sha256 }) => ({ sha256 })) }),
      });
      state.uploads = { ...state.uploads, ...(cached.uploads || {}) };
    } catch (error) {
      setPreviewStatus(`读取本机图片银行缓存失败：${error.message}`, 'error');
      return;
    }
    const pending = unique.filter((image) => !state.uploads[image.sha256]);
    if (pending.length && !windowRef.confirm(
      `将 ${pending.length} 张图片上传到当前店铺的阿里图片银行。\n\n这不会创建、修改或发布商品。是否继续？`,
    )) return;

    elements.uploadImages.disabled = true;
    try {
      for (const [index, image] of pending.entries()) {
        setPreviewStatus(`正在上传 ${index + 1} / ${pending.length}：${image.fileName}`);
        const common = {
          config: getAlibabaConfig(),
          groupId: getPhotobankGroupId(),
          confirmed: true,
          sha256: image.sha256,
        };
        const upload = image.file
          ? await requestJson('/api/alibaba/photobank/upload', {
            method: 'POST',
            body: JSON.stringify({
              ...common,
              image: {
                fileName: image.fileName,
                dataUrl: await fileToDataUrl(image.file),
                sha256: image.sha256,
              },
            }),
          })
          : await requestJson('/api/obsidian/fixed-images/upload', {
            method: 'POST',
            body: JSON.stringify(common),
          });
        state.uploads[image.sha256] = upload;
      }
      resolveSharedUploadedImages(assignments, state.uploads);
      elements.generatePreviews.disabled = false;
      setPreviewStatus(`${unique.length} 张实际使用图片已在图片银行就绪；尚未创建商品。`, 'success');
      for (const variant of state.variants) {
        const card = elements.variants.querySelector(`[data-plan-id="${CSS.escape(variant.id)}"]`);
        text(card?.querySelector('.obsidian-variant-status'), '图片银行已就绪');
      }
    } catch (error) {
      setPreviewStatus(`上传中断：${error.message}。成功项不会重复上传。`, 'error');
    } finally {
      elements.uploadImages.disabled = false;
    }
  });
  elements.generatePreviews.addEventListener('click', async () => {
    elements.generatePreviews.disabled = true;
    setPreviewStatus('正在生成四份完整本地 Schema；不会提交商品。');
    try {
      const assignments = buildSharedImageAssignments(state);
      const imagesByPlan = resolveSharedUploadedImages(assignments, state.uploads);
      const result = await requestJson('/api/obsidian/preview', {
        method: 'POST',
        body: JSON.stringify(buildPreviewRequest(state, imagesByPlan)),
      });
      state.previews = result.previews;
      state.sessionId = result.sessionId;
      state.taskId = result.taskId;
      state.draftItems = Object.fromEntries(result.previews.map((preview) => [
        preview.planId,
        { planId: preview.planId, fingerprint: preview.fingerprint, status: 'preview_ready' },
      ]));
      for (const preview of state.previews) {
        const card = elements.variants.querySelector(`[data-plan-id="${CSS.escape(preview.planId)}"]`);
        text(card?.querySelector('.obsidian-variant-status'), `完整预览通过 · ${preview.fingerprint.slice(0, 10)}`);
        const button = card?.querySelector('.obsidian-draft-button');
        if (button) button.disabled = false;
      }
      setPreviewStatus('四份完整预览均通过：标题、卖点、FAQ、10 条属性和 6 张图片已替换，受保护字段保持不变。', 'success');
      text(elements.draftStatus, '草稿测试已就绪。请逐个核对方案卡，然后单独点击并确认。');
    } catch (error) {
      setPreviewStatus(error.message, 'error');
      elements.generatePreviews.disabled = false;
    }
  });
  elements.variants.addEventListener('click', async (event) => {
    const button = event.target.closest('.obsidian-draft-button');
    if (!button) return;
    const planId = button.dataset.planId;
    const preview = state.previews.find((candidate) => candidate.planId === planId);
    const variant = state.variants.find((candidate) => candidate.id === planId);
    if (!preview || !variant || !state.sessionId) return;
    const confirmed = windowRef.confirm(
      `即将在阿里国际站创建 1 个商品草稿：\n\n${variant.title}\n\n母商品 ID：${state.sourceProductId}\n方案：${planId}\n\n只创建这一份草稿，不会正式发布。是否继续？`,
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = '正在创建草稿…';
    text(elements.draftStatus, `正在提交 ${planId}；不会自动提交下一份。`);
    try {
      const result = await requestJson('/api/obsidian/draft', {
        method: 'POST',
        body: JSON.stringify({
          config: getAlibabaConfig(),
          sessionId: state.sessionId,
          planId,
          fingerprint: preview.fingerprint,
          confirmed: true,
        }),
      });
      state.draftItems[planId] = result.item;
      button.textContent = `草稿已创建 · ${result.item.draftProductId}`;
      const card = button.closest('.obsidian-variant-card');
      text(card?.querySelector('.obsidian-variant-status'), `草稿 ID ${result.item.draftProductId}`);
      text(elements.draftStatus, `${planId} 草稿已创建。请先在阿里后台核对，再继续下一份。`);
      await refreshSavedDrafts();
    } catch (error) {
      if (error.item) state.draftItems[planId] = error.item;
      if (error.item?.status === 'result_unknown') {
        button.textContent = '结果未知 · 禁止重试';
        text(elements.draftStatus, `${planId} 返回结果未知。不要重试；请先按标题和时间到阿里后台核对。`);
      } else if (error.item?.status === 'failed') {
        button.textContent = '阿里明确拒绝 · 查看提示';
        text(elements.draftStatus, `${planId} 创建失败：${error.message}`);
      } else {
        button.textContent = '无法创建草稿';
        text(elements.draftStatus, error.message);
      }
    }
  });

  elements.savedDrafts.addEventListener('click', async (event) => {
    const button = event.target.closest('.obsidian-draft-verify-button');
    if (!button) return;
    const resultElement = button.closest('.obsidian-saved-draft')
      ?.querySelector('.obsidian-draft-verify-result');
    button.disabled = true;
    button.textContent = '正在只读核对…';
    text(resultElement, '正在读取阿里草稿，不会修改商品。');
    try {
      const result = await requestJson('/api/obsidian/draft/verify', {
        method: 'POST',
        body: JSON.stringify({
          config: getAlibabaConfig(),
          taskId: button.dataset.taskId,
          planId: button.dataset.planId,
        }),
      });
      text(resultElement, formatDraftVerification(result));
      resultElement.dataset.kind = result.comparison.exactMatch ? 'success' : 'error';
    } catch (error) {
      const trace = error.traceId ? `；追踪号 ${error.traceId}` : '';
      text(resultElement, `读取失败：${error.message}${trace}`);
      resultElement.dataset.kind = 'error';
    } finally {
      button.disabled = false;
      button.textContent = '重新读取并核对';
    }
  });

  renderBatchList();
  renderPlans();
  loadFixedImages();
  refreshSavedDrafts();
  return { state, refreshBatches };
}
import { fileToDataUrl } from './similar-product-ui.js';
