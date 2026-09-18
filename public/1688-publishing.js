export const STORAGE_KEYS_1688 = Object.freeze({
  profile: 'icbu-workbench-1688-profile',
  persistentSecret: 'icbu-workbench-1688-secret',
  persistentToken: 'icbu-workbench-1688-token',
  persistentRefreshToken: 'icbu-workbench-1688-refresh-token',
  sessionSecret: 'icbu-workbench-1688-session-secret',
  sessionToken: 'icbu-workbench-1688-session-token',
  sessionRefreshToken: 'icbu-workbench-1688-session-refresh-token',
});

export function create1688PublishingState() {
  return {
    refreshToken: '',
    connection: null,
    sdkReady: false,
    categories: [],
    category: null,
    scene: '',
    schemaResponse: null,
    schemaHash: '',
    uploadedImages: [],
    preflight: null,
    task: null,
    publication: null,
    busy: false,
  };
}

export function choose1688TaskToRestore(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  return [...tasks].sort((left, right) => (
    String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  ))[0] || null;
}

export function extract1688Categories(response = {}) {
  const values = response.products || response.categoryInfo || response.result?.products
    || response.result?.categoryInfo || [];
  return (Array.isArray(values) ? values : []).map((category) => ({
    id: String(category.categoryID ?? category.categoryId ?? category.id ?? ''),
    name: String(category.name || category.categoryName || category.categoryNamePath || ''),
    categoryType: category.categoryType === undefined ? '' : String(category.categoryType),
  })).filter((category) => category.id);
}

function parseJsonField(value, label, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}不是有效 JSON`);
  }
}

export function build1688FormValues(input = {}, uploadedImages = []) {
  const attributes = parseJsonField(input.attributesJson, '商品属性', {});
  const skus = parseJsonField(input.skusJson, 'SKU ', []);
  const priceRanges = parseJsonField(input.priceRangesJson, '阶梯价格', []);
  if (!Array.isArray(skus)) throw new Error('SKU 必须是 JSON 数组');
  if (!Array.isArray(priceRanges)) throw new Error('阶梯价格必须是 JSON 数组');
  return {
    title: String(input.title || '').trim(),
    cargoNumber: String(input.cargoNumber || '').trim(),
    catProp: attributes,
    skuTable: skus,
    priceRange: priceRanges,
    beginAmount: Number(input.beginAmount || 0),
    primaryPicture: {
      imageList: uploadedImages.map((image) => ({
        ...(image.id === undefined ? {} : { id: String(image.id) }),
        url: String(image.url || ''),
      })).filter((image) => image.url),
    },
    description: {
      detailList: [{
        id: '0',
        title: '图文详情',
        contentUrl: null,
        content: String(input.detailHtml || ''),
        isRequired: true,
      }],
    },
  };
}

export function format1688ConnectionDiagnostic(result = {}) {
  const missing = Array.isArray(result.missing) ? result.missing.filter(Boolean) : [];
  return {
    tone: result.ok ? 'success' : 'error',
    message: `${result.message || (result.ok ? '1688 只读连接验证成功' : '1688 连接验证失败')}${
      missing.length ? `；缺少：${missing.join('、')}` : ''
    }`,
  };
}

export function canPublish1688Card({ preflight, connection, sdkReady, task, publication }) {
  const blockers = [];
  if (!preflight?.valid) blockers.push('本地预检未通过');
  if (!connection?.ok || connection.writeReady !== true) blockers.push('1688 写权限未验证');
  if (!sdkReady) blockers.push('官方前端 JS SDK 未就绪');
  if (!task?.id) blockers.push('任务尚未保存');
  if (publication?.writeConsumed || !['ready', undefined, null].includes(publication?.status)) {
    blockers.push('当前商品已经提交过，只能只读核验');
  }
  return { allowed: blockers.length === 0, blockers };
}

export function build1688TaskPayload(input) {
  return {
    categoryId: String(input.categoryId),
    scene: String(input.scene),
    schema: input.schemaResponse,
    schemaHash: String(input.schemaHash),
    product: {
      key: 'product-1',
      title: String(input.formValues.title || ''),
      cargoNumber: String(input.formValues.cargoNumber || ''),
      formValues: input.formValues,
    },
    publication: {
      status: 'ready',
      writeConsumed: false,
      fingerprint: String(input.fingerprint),
      schemaHash: String(input.schemaHash),
    },
  };
}

export function build1688PublishUiRequest({ task, publication, config, sdkReady }) {
  return {
    path: `/api/1688/tasks/${encodeURIComponent(task.id)}/products/product-1/publish`,
    body: {
      config,
      version: task.version,
      fingerprint: publication.fingerprint,
      schemaHash: publication.schemaHash,
      sdkReady: sdkReady === true,
      confirmation: true,
    },
  };
}

export function format1688PublicationStatus(publication = {}) {
  const productId = publication.productId ? `商品 ${publication.productId}` : '当前商品';
  const formats = {
    published_verified: { tone: 'success', message: `${productId} 已通过官方只读查询核验为已发布` },
    review_pending: { tone: '', message: `${productId} 正在审核中，将只进行只读核验` },
    uncertain: { tone: 'error', message: '发布结果不确定，严禁重复提交；请点击只读核验' },
    publish_failed: { tone: 'error', message: `发布失败：${publication.errorMessage || publication.errorCode || '未知业务错误'}` },
    verification_failed: { tone: 'error', message: `官方核验失败：${publication.errorMessage || publication.errorCode || '状态异常'}` },
    verification_ambiguous: { tone: 'error', message: '查询到多个候选商品，需要人工核对，不能自动选择' },
    verify_pending: { tone: '', message: `${productId} 已收到发布响应，等待官方只读核验` },
    publishing: { tone: '', message: '正在调用一次真实发布接口，请勿重复点击' },
    ready: { tone: '', message: '本地预览已就绪，尚未调用真实发布接口' },
  };
  return formats[publication.status] || { tone: '', message: '尚未发布' };
}

function categoryScene(category) {
  const scenes = { 1: 'cbu', 2: 'industry', 3: 'popular' };
  return scenes[Number(category?.categoryType)] || '';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result), { once: true });
    reader.addEventListener('error', () => reject(new Error(`无法读取图片 ${file.name}`)), { once: true });
    reader.readAsDataURL(file);
  });
}

export function init1688Publishing({ requestJson }) {
  const state = create1688PublishingState();
  const byId = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'gateway', 'authorize-url', 'app-key', 'app-name', 'app-secret', 'redirect-uri',
    'access-token', 'auth-code', 'remember', 'save', 'authorize', 'exchange', 'refresh',
    'test', 'connection-status', 'sdk-test', 'sdk-status', 'category-keyword',
    'category-search', 'category-select', 'load-schema', 'schema-status', 'schema-fields',
    'title', 'cargo-number', 'begin-amount', 'attributes', 'skus', 'price-ranges',
    'detail', 'images', 'upload-images', 'image-status', 'image-list', 'preflight',
    'preflight-status', 'preview', 'save-task', 'publish', 'reconcile', 'publication-status',
  ].map((name) => [`1688-${name}`, byId(`1688-${name}`)]));

  const element = (name) => elements[`1688-${name}`];
  const setStatus = (target, message, tone = '') => {
    target.textContent = message;
    target.classList.remove('success', 'error');
    if (tone) target.classList.add(tone);
  };
  const setBusy = (button, busy, text) => {
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = text;
    } else button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = busy;
  };

  function getConfig() {
    return {
      gatewayUrl: element('gateway').value.trim(),
      authorizeUrl: element('authorize-url').value.trim(),
      appKey: element('app-key').value.trim(),
      appName: element('app-name').value.trim(),
      appSecret: element('app-secret').value,
      redirectUri: element('redirect-uri').value.trim(),
      accessToken: element('access-token').value,
    };
  }

  function restoreConfig() {
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(STORAGE_KEYS_1688.profile) || '{}'); } catch { profile = {}; }
    element('gateway').value = profile.gatewayUrl || 'https://gw.open.1688.com';
    element('authorize-url').value = profile.authorizeUrl || 'https://auth.1688.com/oauth/authorize';
    element('app-key').value = profile.appKey || '';
    element('app-name').value = profile.appName || '';
    element('redirect-uri').value = profile.redirectUri || '';
    element('app-secret').value = localStorage.getItem(STORAGE_KEYS_1688.persistentSecret)
      || sessionStorage.getItem(STORAGE_KEYS_1688.sessionSecret) || '';
    element('access-token').value = localStorage.getItem(STORAGE_KEYS_1688.persistentToken)
      || sessionStorage.getItem(STORAGE_KEYS_1688.sessionToken) || '';
    state.refreshToken = localStorage.getItem(STORAGE_KEYS_1688.persistentRefreshToken)
      || sessionStorage.getItem(STORAGE_KEYS_1688.sessionRefreshToken) || '';
    element('remember').checked = Boolean(localStorage.getItem(STORAGE_KEYS_1688.persistentSecret));
  }

  function saveConfig() {
    const config = getConfig();
    localStorage.setItem(STORAGE_KEYS_1688.profile, JSON.stringify({
      gatewayUrl: config.gatewayUrl,
      authorizeUrl: config.authorizeUrl,
      appKey: config.appKey,
      appName: config.appName,
      redirectUri: config.redirectUri,
    }));
    const target = element('remember').checked ? localStorage : sessionStorage;
    const other = element('remember').checked ? sessionStorage : localStorage;
    target.setItem(element('remember').checked ? STORAGE_KEYS_1688.persistentSecret : STORAGE_KEYS_1688.sessionSecret, config.appSecret);
    target.setItem(element('remember').checked ? STORAGE_KEYS_1688.persistentToken : STORAGE_KEYS_1688.sessionToken, config.accessToken);
    if (state.refreshToken) target.setItem(
      element('remember').checked ? STORAGE_KEYS_1688.persistentRefreshToken : STORAGE_KEYS_1688.sessionRefreshToken,
      state.refreshToken,
    );
    for (const key of Object.values(STORAGE_KEYS_1688)) {
      if (key !== STORAGE_KEYS_1688.profile) other.removeItem(key);
    }
    setStatus(element('connection-status'), '1688 配置已保存在当前浏览器中。', 'success');
  }

  function currentFormValues() {
    return build1688FormValues({
      title: element('title').value,
      cargoNumber: element('cargo-number').value,
      beginAmount: element('begin-amount').value,
      attributesJson: element('attributes').value,
      skusJson: element('skus').value,
      priceRangesJson: element('price-ranges').value,
      detailHtml: element('detail').value,
    }, state.uploadedImages);
  }

  function renderImages() {
    element('image-list').replaceChildren(...state.uploadedImages.map((image, index) => {
      const item = document.createElement('span');
      item.textContent = `${index + 1}. ${image.name || image.url}`;
      return item;
    }));
  }

  function renderPublication() {
    const formatted = format1688PublicationStatus(state.publication || state.task?.publication);
    setStatus(element('publication-status'), formatted.message, formatted.tone);
    const gate = canPublish1688Card({
      preflight: state.preflight?.preflight,
      connection: state.connection,
      sdkReady: state.sdkReady,
      task: state.task,
      publication: state.publication || state.task?.publication,
    });
    element('publish').disabled = !gate.allowed;
    element('publish').title = gate.blockers.join('；');
    element('reconcile').disabled = !['uncertain', 'verify_pending', 'review_pending'].includes(
      (state.publication || state.task?.publication)?.status,
    );
  }

  element('save').addEventListener('click', saveConfig);
  element('authorize').addEventListener('click', () => {
    const config = getConfig();
    if (!config.appKey || !config.redirectUri) {
      setStatus(element('connection-status'), '请先填写 1688 App Key 和 HTTPS 回调地址。', 'error');
      return;
    }
    const url = new URL(config.authorizeUrl || 'https://auth.1688.com/oauth/authorize');
    url.searchParams.set('client_id', config.appKey);
    url.searchParams.set('site', '1688');
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('state', `workbench-1688-${Date.now()}`);
    window.open(url, '_blank', 'noopener,noreferrer');
  });
  element('exchange').addEventListener('click', async () => {
    try {
      const raw = element('auth-code').value.trim();
      let code = raw;
      try { code = new URL(raw).searchParams.get('code') || raw; } catch { code = raw; }
      const result = await requestJson('/api/1688/token/exchange', {
        method: 'POST', body: JSON.stringify({ config: getConfig(), code }),
      });
      element('access-token').value = result.accessToken;
      state.refreshToken = result.refreshToken || '';
      setStatus(element('connection-status'), '1688 授权成功。请保存配置并执行只读连接测试。', 'success');
    } catch (error) { setStatus(element('connection-status'), error.message, 'error'); }
  });
  element('refresh').addEventListener('click', async () => {
    try {
      const result = await requestJson('/api/1688/token/refresh', {
        method: 'POST', body: JSON.stringify({ config: getConfig(), refreshToken: state.refreshToken }),
      });
      element('access-token').value = result.accessToken;
      state.refreshToken = result.refreshToken || state.refreshToken;
      setStatus(element('connection-status'), '1688 Access Token 已刷新。', 'success');
    } catch (error) { setStatus(element('connection-status'), error.message, 'error'); }
  });
  element('test').addEventListener('click', async () => {
    setBusy(element('test'), true, '正在验证…');
    try {
      state.connection = await requestJson('/api/1688/connection/test', {
        method: 'POST', body: JSON.stringify({ config: getConfig() }),
      });
      const formatted = format1688ConnectionDiagnostic(state.connection);
      setStatus(element('connection-status'), formatted.message, formatted.tone);
    } catch (error) {
      state.connection = { ok: false, writeReady: false };
      setStatus(element('connection-status'), error.message, 'error');
    } finally { setBusy(element('test'), false); renderPublication(); }
  });
  element('sdk-test').addEventListener('click', async () => {
    const config = getConfig();
    if (!config.appKey || !config.appName) {
      setStatus(element('sdk-status'), '请先填写 App Key 和与开放平台后台完全一致的应用名称。', 'error');
      return;
    }
    window.__1688_OPEN_SDK_CONFIG = { appKey: config.appKey, appName: config.appName };
    try {
      if (!window.__1688_OPEN_SDK) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://o.alicdn.com/fuwu-assets/alife-open-sdk/index.js';
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', () => reject(new Error('官方 JS SDK 加载失败')), { once: true });
          document.head.append(script);
        });
      }
      state.sdkReady = Boolean(window.__1688_OPEN_SDK);
      setStatus(element('sdk-status'), state.sdkReady ? '官方 JS SDK 已加载并完成基础初始化。' : '官方 JS SDK 未暴露初始化对象。', state.sdkReady ? 'success' : 'error');
    } catch (error) {
      state.sdkReady = false;
      setStatus(element('sdk-status'), error.message, 'error');
    }
    renderPublication();
  });
  element('category-search').addEventListener('click', async () => {
    try {
      const response = await requestJson('/api/1688/categories/search', {
        method: 'POST',
        body: JSON.stringify({ config: getConfig(), keyword: element('category-keyword').value.trim() }),
      });
      state.categories = extract1688Categories(response);
      element('category-select').replaceChildren(...state.categories.map((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = `${category.name}（${category.id}）`;
        return option;
      }));
      setStatus(element('schema-status'), `找到 ${state.categories.length} 个候选类目，请选择叶子类目后读取规则。`, state.categories.length ? 'success' : 'error');
    } catch (error) { setStatus(element('schema-status'), error.message, 'error'); }
  });
  element('load-schema').addEventListener('click', async () => {
    try {
      const categoryId = element('category-select').value;
      const details = await requestJson('/api/1688/categories/get', {
        method: 'POST', body: JSON.stringify({ config: getConfig(), categoryId }),
      });
      const detailCategories = extract1688Categories(details);
      state.category = detailCategories.find((item) => item.id === categoryId)
        || state.categories.find((item) => item.id === categoryId);
      state.scene = categoryScene(state.category);
      if (!state.scene) throw new Error('当前类目没有返回可识别的 categoryType，无法确定发布场景');
      state.schemaResponse = await requestJson('/api/1688/schema/get', {
        method: 'POST',
        body: JSON.stringify({ config: getConfig(), catId: categoryId, scene: state.scene }),
      });
      const data = state.schemaResponse.result?.bizData || state.schemaResponse.bizData || '{}';
      let schema = {};
      try { schema = typeof data === 'string' ? JSON.parse(data) : data; } catch { schema = {}; }
      const fields = Object.values(schema.fields || schema.schema?.fields || {});
      element('schema-fields').textContent = fields.length
        ? fields.map((field) => `${field.required ? '必填' : '可选'} · ${field.label || field.name || field.id} · ${field.type || field.uiType || field.tag}`).join('\n')
        : '规则已读取；该类目的字段结构将在预检时按官方 Schema 解析。';
      setStatus(element('schema-status'), `已读取类目 ${categoryId} 的 ${state.scene} 发布规则。`, 'success');
      state.connection = {
        ok: true,
        stage: 'schema',
        message: '1688 只读连接和目标类目新版商品规则验证成功',
        missing: [],
        writeReady: true,
      };
      setStatus(element('connection-status'), state.connection.message, 'success');
      renderPublication();
    } catch (error) { setStatus(element('schema-status'), error.message, 'error'); }
  });
  element('upload-images').addEventListener('click', async () => {
    const files = [...element('images').files];
    if (!files.length) return setStatus(element('image-status'), '请先选择本地图片。', 'error');
    setBusy(element('upload-images'), true, '正在上传…');
    try {
      for (const file of files) {
        const result = await requestJson('/api/1688/images/upload', {
          method: 'POST',
          body: JSON.stringify({
            confirmUpload: true,
            config: getConfig(),
            image: { fileName: file.name, dataUrl: await fileToDataUrl(file), albumId: '' },
          }),
        });
        state.uploadedImages.push({ ...result.image, name: file.name });
      }
      renderImages();
      setStatus(element('image-status'), `已上传 ${state.uploadedImages.length} 张官方图片。`, 'success');
    } catch (error) { setStatus(element('image-status'), error.message, 'error'); }
    finally { setBusy(element('upload-images'), false); }
  });
  element('preflight').addEventListener('click', async () => {
    try {
      if (!state.schemaResponse) throw new Error('请先读取当前类目的官方发布规则');
      const formValues = currentFormValues();
      state.preflight = await requestJson('/api/1688/preflight', {
        method: 'POST',
        body: JSON.stringify({
          schema: state.schemaResponse,
          catId: state.category.id,
          scene: state.scene,
          formValues,
        }),
      });
      state.schemaHash = state.preflight.schemaHash;
      const errors = [
        ...(state.preflight.preflight.errors || []).map((item) => `${item.label || item.path}：${item.message}`),
        ...(state.preflight.preflight.unsupported || []).map((item) => `${item.label || item.path}：暂不支持组件 ${item.type}`),
      ];
      setStatus(element('preflight-status'), errors.length ? errors.join('；') : '本地只读预检通过。尚未调用真实发布接口。', errors.length ? 'error' : 'success');
      element('preview').textContent = JSON.stringify({
        product: formValues,
        requestSummary: state.preflight.summary,
        fingerprint: state.preflight.fingerprint,
      }, null, 2);
      renderPublication();
    } catch (error) { setStatus(element('preflight-status'), error.message, 'error'); }
  });
  element('save-task').addEventListener('click', async () => {
    try {
      if (!state.preflight?.preflight?.valid) throw new Error('请先完成并通过本地预检');
      const taskPayload = build1688TaskPayload({
        categoryId: state.category.id,
        scene: state.scene,
        schemaResponse: state.schemaResponse,
        schemaHash: state.preflight.schemaHash,
        formValues: currentFormValues(),
        fingerprint: state.preflight.fingerprint,
      });
      const result = await requestJson('/api/1688/tasks', {
        method: 'POST', body: JSON.stringify({ task: taskPayload }),
      });
      state.task = result.task;
      state.publication = result.task.publication;
      setStatus(element('publication-status'), `任务 ${state.task.id} 已安全保存到本机。`, 'success');
      renderPublication();
    } catch (error) { setStatus(element('publication-status'), error.message, 'error'); }
  });
  element('publish').addEventListener('click', async () => {
    const gate = canPublish1688Card({
      preflight: state.preflight?.preflight, connection: state.connection,
      sdkReady: state.sdkReady, task: state.task, publication: state.publication,
    });
    if (!gate.allowed) return setStatus(element('publication-status'), gate.blockers.join('；'), 'error');
    setBusy(element('publish'), true, '正在发布一次…');
    try {
      const request = build1688PublishUiRequest({
        task: state.task, publication: state.publication, config: getConfig(), sdkReady: state.sdkReady,
      });
      const result = await requestJson(request.path, { method: 'POST', body: JSON.stringify(request.body) });
      state.task = result.task;
      state.publication = result.publication;
    } catch (error) {
      if (error.publication) state.publication = error.publication;
      setStatus(element('publication-status'), error.message, 'error');
    } finally { setBusy(element('publish'), false); renderPublication(); }
  });
  element('reconcile').addEventListener('click', async () => {
    try {
      const result = await requestJson(`/api/1688/publications/${encodeURIComponent(state.task.id)}/reconcile`, {
        method: 'POST', body: JSON.stringify({ config: getConfig() }),
      });
      state.task = result.task;
      state.publication = result.publication;
    } catch (error) { setStatus(element('publication-status'), error.message, 'error'); }
    renderPublication();
  });

  restoreConfig();
  renderImages();
  renderPublication();
  requestJson('/api/1688/tasks')
    .then((result) => {
      const task = choose1688TaskToRestore(result.tasks);
      if (!task) return;
      const formValues = task.product?.formValues || {};
      state.task = task;
      state.publication = task.publication || null;
      state.scene = task.scene || '';
      state.schemaResponse = task.schema || null;
      state.schemaHash = task.schemaHash || '';
      state.category = task.categoryId ? { id: String(task.categoryId) } : null;
      state.uploadedImages = (formValues.primaryPicture?.imageList || []).map((image) => ({ ...image }));
      element('title').value = formValues.title || task.product?.title || '';
      element('cargo-number').value = formValues.cargoNumber || task.product?.cargoNumber || '';
      element('begin-amount').value = formValues.beginAmount || '';
      element('attributes').value = JSON.stringify(formValues.catProp || {}, null, 2);
      element('skus').value = JSON.stringify(formValues.skuTable || [], null, 2);
      element('price-ranges').value = JSON.stringify(formValues.priceRange || [], null, 2);
      element('detail').value = formValues.description?.detailList?.[0]?.content || '';
      renderImages();
      renderPublication();
      setStatus(element('preflight-status'), `已恢复任务 ${task.id}。发布前请重新执行只读预检与连接验证。`);
    })
    .catch((error) => setStatus(element('publication-status'), `读取 1688 本机任务失败：${error.message}`, 'error'));
  return state;
}
