import crypto from 'node:crypto';

const DEFAULT_GATEWAY = 'https://open-api.alibaba.com';

function requireConfig(config = {}, needsAccessToken = true) {
  const normalized = {
    gatewayUrl: String(config.gatewayUrl || DEFAULT_GATEWAY).trim().replace(/\/+$/, ''),
    appKey: String(config.appKey || '').trim(),
    appSecret: String(config.appSecret || '').trim(),
    accessToken: String(config.accessToken || '').trim(),
  };
  const missing = [
    ['App Key', normalized.appKey],
    ['App Secret', normalized.appSecret],
    ...(needsAccessToken ? [['Access Token', normalized.accessToken]] : []),
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`请填写${missing.join('、')}`);
  if (!/^https:\/\//i.test(normalized.gatewayUrl)) throw new Error('阿里网关必须使用 HTTPS 地址');
  return normalized;
}

export function signAlibabaParams(params, appSecret) {
  const payload = Object.keys(params)
    .sort()
    .filter((key) => key && params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .map((key) => `${key}${params[key]}`)
    .join('');
  return crypto
    .createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export function signAlibabaGopRequest(apiPath, params, appSecret) {
  const sortedParams = Object.keys(params)
    .sort()
    .filter((key) => key && params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .map((key) => `${key}${params[key]}`)
    .join('');
  return crypto
    .createHmac('sha256', appSecret)
    .update(`${apiPath}${sortedParams}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

async function callAlibabaGop(config, apiPath, apiParams, fetchImpl, timestamp) {
  const credentials = requireConfig(config, false);
  const params = {
    app_key: credentials.appKey,
    timestamp: String(timestamp),
    sign_method: 'sha256',
    ...apiParams,
  };
  params.sign = signAlibabaGopRequest(apiPath, params, credentials.appSecret);

  const response = await fetchImpl(`${credentials.gatewayUrl}/rest${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(params),
  });
  const body = await response.json().catch(() => ({}));
  const apiError = body.error_response || (body.code && !body.access_token ? body : null);
  if (!response.ok || apiError) {
    throw new Error(apiError?.msg || apiError?.message || `阿里授权请求失败（HTTP ${response.status}）`);
  }
  return body;
}

function normalizeTokenResponse(body) {
  if (!body.access_token) throw new Error('阿里授权成功，但接口没有返回 Access Token');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || '',
    expiresIn: body.expires_in,
    refreshExpiresIn: body.refresh_expires_in,
    account: body.account || body.account_id || body.user_id || '',
  };
}

export async function exchangeAlibabaCode(
  config,
  code,
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const authorizationCode = String(code || '').trim();
  if (!authorizationCode) throw new Error('请填写阿里返回的授权码');
  const body = await callAlibabaGop(
    config,
    '/auth/token/create',
    { code: authorizationCode },
    fetchImpl,
    timestamp,
  );
  return normalizeTokenResponse(body);
}

export async function refreshAlibabaToken(
  config,
  refreshToken,
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const token = String(refreshToken || '').trim();
  if (!token) throw new Error('没有可用于刷新的 Refresh Token');
  const body = await callAlibabaGop(
    config,
    '/auth/token/refresh',
    { refresh_token: token },
    fetchImpl,
    timestamp,
  );
  return normalizeTokenResponse(body);
}

function encodeApiParams(apiParams = {}) {
  return Object.fromEntries(Object.entries(apiParams).map(([key, value]) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return [key, serialized];
  }));
}

export async function callAlibabaApi(
  config,
  method,
  apiParams = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const credentials = requireConfig(config);
  if (!method || !/^alibaba\.[a-z0-9_.]+$/i.test(method)) throw new Error('阿里 API 名称无效');

  const params = {
    app_key: credentials.appKey,
    v: '2.0',
    timestamp: String(timestamp),
    method,
    format: 'json',
    session: credentials.accessToken,
    sign_method: 'sha256',
    ...encodeApiParams(apiParams),
  };
  params.sign = signAlibabaParams(params, credentials.appSecret);

  const url = `${credentials.gatewayUrl}/sync?method=${encodeURIComponent(method)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error_response) {
    const details = body.error_response || {};
    const error = new Error(details.msg || details.sub_msg || (
      response.ok ? '阿里接口返回错误' : `阿里接口请求失败（HTTP ${response.status}）`
    ));
    error.code = details.code || details.sub_code;
    error.subCode = details.sub_code;
    error.requestId = details.request_id;
    throw error;
  }
  return body;
}

export async function uploadAlibabaPhoto(
  config,
  image = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const credentials = requireConfig(config);
  const fileName = String(image.fileName || '').trim().split(/[\\/]/).pop();
  const mimeType = String(image.mimeType || '').trim().toLowerCase();
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!fileName) throw new Error('图片名称不能为空');
  if (!supportedTypes.has(mimeType)) throw new Error('仅支持 JPG、PNG 或 WebP 图片');

  const imageBytes = Buffer.isBuffer(image.imageBytes)
    ? image.imageBytes
    : Buffer.from(image.imageBytes || []);
  if (!imageBytes.length) throw new Error('图片内容为空');

  const method = 'alibaba.icbu.photobank.upload';
  const params = {
    app_key: credentials.appKey,
    v: '2.0',
    timestamp: String(timestamp),
    method,
    format: 'json',
    session: credentials.accessToken,
    sign_method: 'sha256',
    extra_context: typeof image.extraContext === 'string'
      ? image.extraContext
      : JSON.stringify(image.extraContext || {}),
    file_name: fileName,
  };
  const groupId = String(image.groupId || '').trim();
  if (groupId) params.group_id = groupId;
  params.sign = signAlibabaParams(params, credentials.appSecret);

  const form = new FormData();
  Object.entries(params).forEach(([key, value]) => form.append(key, value));
  form.append('image_bytes', new Blob([imageBytes], { type: mimeType }), fileName);

  const response = await fetchImpl(
    `${credentials.gatewayUrl}/sync?method=${encodeURIComponent(method)}`,
    { method: 'POST', body: form },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error_response?.msg || `阿里图片上传失败（HTTP ${response.status}）`);
  if (body.error_response) {
    const error = new Error(body.error_response.msg || body.error_response.sub_msg || '阿里图片上传返回错误');
    error.code = body.error_response.code || body.error_response.sub_code;
    error.requestId = body.error_response.request_id;
    throw error;
  }

  const result = body.alibaba_icbu_photobank_upload_response?.upload_image_response
    || body.upload_image_response;
  if (!result?.photobank_url) throw new Error('图片银行上传成功，但未返回图片地址');
  return {
    fileName: result.file_name || fileName,
    fileId: String(result.file_id || ''),
    photobankUrl: result.photobank_url,
    requestId: body.request_id || '',
  };
}

export async function testAlibabaConnection(config, fetchImpl = fetch) {
  const body = await callAlibabaApi(config, 'alibaba.icbu.product.schema.get', {
    param_product_top_publish_request: {
      publish_type: 'default',
      cat_id: 333,
      language: 'zh',
      version: 'trade.1.1',
    },
  }, fetchImpl);
  const result = body.alibaba_icbu_product_schema_get_response || {};
  return {
    ok: true,
    message: '阿里接口签名和授权验证成功',
    requestId: body.request_id || '',
    traceId: result.trace_id || '',
  };
}

export async function loadAlibabaProductTemplate(
  config,
  productId,
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const sourceProductId = String(productId || '').trim();
  if (!/^\d+$/.test(sourceProductId)) throw new Error('主产品 ID 必须是数字');

  const body = await callAlibabaApi(config, 'alibaba.icbu.product.schema.render', {
    param_product_top_publish_request: {
      publish_type: 'default',
      product_id: sourceProductId,
      language: 'zh',
      version: 'trade.1.1',
    },
  }, fetchImpl, timestamp);
  const result = body.alibaba_icbu_product_schema_render_response || {};
  if (result.biz_success !== true && result.biz_success !== 'true') {
    const error = new Error(result.message || '阿里未能读取这个主产品模板');
    error.code = result.msg_code;
    error.traceId = result.trace_id;
    throw error;
  }
  if (!result.data) throw new Error('阿里已返回成功，但商品模板内容为空');

  return {
    sourceProductId,
    schemaXml: result.data,
    requestId: body.request_id || '',
    traceId: result.trace_id || '',
  };
}

export async function loadAlibabaProductContext(
  config,
  { productId } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const sourceProductId = String(productId || '').trim();
  if (!/^\d+$/.test(sourceProductId)) throw new Error('母商品 ID 必须是数字');

  const encrypted = await callAlibabaApi(config, 'alibaba.icbu.product.id.encrypt', {
    language: 'ENGLISH',
    product_id: sourceProductId,
  }, fetchImpl, timestamp);
  const encryptResult = encrypted.alibaba_icbu_product_id_encrypt_response || encrypted;
  const secretId = String(encryptResult.secret_id || '').trim();
  if (!secretId) {
    const code = String(encryptResult.code || encrypted.code || '').trim();
    const detail = String(
      encryptResult.message || encryptResult.msg || encrypted.message || encrypted.msg || '',
    ).trim();
    const error = new Error(
      `${detail || '阿里未返回可读取商品详情的加密 ID'}${code ? `（错误码 ${code}）` : ''}`,
    );
    error.code = code;
    error.requestId = encrypted.request_id;
    throw error;
  }

  const productBody = await callAlibabaApi(config, 'alibaba.icbu.product.get', {
    product_id: secretId,
    language: 'ENGLISH',
  }, fetchImpl, timestamp);
  const productResult = productBody.alibaba_icbu_product_get_response || productBody;
  const product = productResult.product || {};
  const categoryId = String(product.category_id || '').trim();
  if (!categoryId) throw new Error('无法从源商品确定类目 ID，已停止生成可写 Schema');
  const sourceProductType = String(product.product_type || '').trim();
  if (!sourceProductType) throw new Error('无法从源商品确定商品类型，已停止生成可写 Schema');

  const publishContext = {
    categoryId,
    language: 'en_US',
    publishType: 'default',
    version: 'trade.1.1',
  };
  const rendered = await callAlibabaApi(config, 'alibaba.icbu.product.schema.render', {
    param_product_top_publish_request: {
      publish_type: publishContext.publishType,
      product_id: sourceProductId,
      cat_id: publishContext.categoryId,
      language: publishContext.language,
      version: publishContext.version,
    },
  }, fetchImpl, timestamp);
  const result = rendered.alibaba_icbu_product_schema_render_response || {};
  if (result.biz_success !== true && result.biz_success !== 'true') {
    const error = new Error(result.message || '阿里未能读取这个母商品的发布 Schema');
    error.code = result.msg_code;
    error.traceId = result.trace_id;
    throw error;
  }
  if (!result.data) throw new Error('阿里已返回成功，但母商品 Schema 内容为空');

  return {
    sourceProductId,
    sourceProductType,
    ...publishContext,
    schemaXml: result.data,
    requestId: rendered.request_id || '',
    traceId: result.trace_id || '',
  };
}

export async function getAlibabaPublishingCapability(
  config,
  { categoryId, language } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const catId = String(categoryId || '').trim();
  const normalizedLanguage = String(language || '').trim();
  if (!catId || !normalizedLanguage) throw new Error('发品权限检查缺少类目或语种');
  const body = await callAlibabaApi(config, 'alibaba.icbu.product.type.available.get', {
    type_request: {
      cat_id: catId,
      language: normalizedLanguage,
    },
  }, fetchImpl, timestamp);
  const response = body.alibaba_icbu_product_type_available_get_response || body;
  const result = response.result || response.data || response;
  return {
    supportPostSourcing: result.support_post_sourcing === true || result.support_post_sourcing === 'true',
    supportPostWholesale: result.support_post_whole_sale === true || result.support_post_whole_sale === 'true',
    requestId: body.request_id || response.request_id || '',
  };
}

export async function loadAlibabaProductDraft(
  config,
  { productId, categoryId, language } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const normalizedProductId = String(productId || '').trim();
  const normalizedCategoryId = String(categoryId || '').trim();
  const normalizedLanguage = String(language || '').trim();
  if (!/^\d+$/.test(normalizedProductId)) throw new Error('草稿商品 ID 必须是数字');
  if (!normalizedCategoryId || !normalizedLanguage) throw new Error('读取草稿缺少类目或语种');

  const body = await callAlibabaApi(config, 'alibaba.icbu.product.schema.render.draft', {
    param_product_top_publish_request: {
      product_id: normalizedProductId,
      cat_id: normalizedCategoryId,
      language: normalizedLanguage,
    },
  }, fetchImpl, timestamp);
  const result = body.alibaba_icbu_product_schema_render_draft_response || body;
  if (result.biz_success !== true && result.biz_success !== 'true') {
    const error = new Error(result.message || '阿里未能读取这个商品草稿');
    error.code = result.msg_code || '';
    error.traceId = result.trace_id || '';
    error.requestId = body.request_id || result.request_id || '';
    throw error;
  }
  if (!result.data) throw new Error('阿里已返回成功，但商品草稿内容为空');
  return {
    productId: normalizedProductId,
    schemaXml: result.data,
    traceId: result.trace_id || '',
    requestId: body.request_id || result.request_id || '',
  };
}

export async function createAlibabaProductDraft(
  config,
  { schemaXml, publishContext } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const xml = String(schemaXml || '').trim();
  if (!xml) throw new Error('草稿 Schema 不能为空');
  const categoryId = String(publishContext?.categoryId || '').trim();
  const language = String(publishContext?.language || '').trim();
  const publishType = String(publishContext?.publishType || '').trim();
  const version = String(publishContext?.version || '').trim();
  if (!categoryId || !language || !publishType) throw new Error('草稿发布上下文不完整');

  const body = await callAlibabaApi(config, 'alibaba.icbu.product.schema.add.draft', {
    param_product_top_publish_request: {
      publish_type: publishType,
      xml,
      cat_id: categoryId,
      language,
      ...(version ? { version } : {}),
    },
  }, fetchImpl, timestamp);
  const result = body.alibaba_icbu_product_schema_add_draft_response || body;
  const bizSuccess = result.biz_success === true || result.biz_success === 'true';
  if (!bizSuccess) {
    const error = new Error(result.message || '阿里明确返回草稿创建失败');
    error.code = result.msg_code || '';
    error.traceId = result.trace_id || '';
    error.requestId = body.request_id || result.request_id || '';
    error.definitive = result.biz_success === false || result.biz_success === 'false';
    throw error;
  }
  const productId = String(result.product_id || '').trim();
  if (!productId) throw new Error('阿里返回草稿成功，但没有商品草稿 ID');
  return {
    bizSuccess: true,
    productId,
    message: result.message || '',
    msgCode: result.msg_code || '',
    traceId: result.trace_id || '',
    requestId: body.request_id || result.request_id || '',
  };
}

export async function createAlibabaProduct(
  config,
  { schemaXml, publishContext } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const xml = String(schemaXml || '').trim();
  if (!xml) throw new Error('正式发布 Schema 不能为空');
  const categoryId = String(publishContext?.categoryId || '').trim();
  const language = String(publishContext?.language || '').trim();
  const publishType = String(publishContext?.publishType || '').trim();
  const version = String(publishContext?.version || '').trim();
  if (!categoryId || !language || !publishType) throw new Error('正式发布上下文不完整');

  const body = await callAlibabaApi(config, 'alibaba.icbu.product.schema.add', {
    param_product_top_publish_request: {
      publish_type: publishType,
      xml,
      cat_id: categoryId,
      language,
      ...(version ? { version } : {}),
    },
  }, fetchImpl, timestamp);
  const result = body.alibaba_icbu_product_schema_add_response || body;
  const bizSuccess = result.biz_success === true || result.biz_success === 'true';
  if (!bizSuccess) {
    const error = new Error(result.message || '阿里明确返回正式发布失败');
    error.code = result.msg_code || '';
    error.traceId = result.trace_id || '';
    error.requestId = body.request_id || result.request_id || '';
    error.definitive = result.biz_success === false || result.biz_success === 'false';
    throw error;
  }
  const productId = String(result.product_id || '').trim();
  if (!productId) throw new Error('阿里返回发布成功，但没有正式商品 ID');
  return {
    productId,
    traceId: result.trace_id || '',
    requestId: body.request_id || result.request_id || '',
  };
}

export async function listAlibabaProducts(
  config,
  { subject, categoryId, modifiedFrom, modifiedTo, pageSize = 30 } = {},
  fetchImpl = fetch,
  timestamp = Date.now(),
) {
  const formatDateTime = (value) => {
    const normalized = String(value || '').trim();
    const iso = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{3})?Z$/);
    return iso ? `${iso[1]} ${iso[2]}` : normalized;
  };
  const normalizedSubject = String(subject || '').trim();
  const normalizedCategoryId = String(categoryId || '').trim();
  const normalizedPageSize = Number(pageSize);
  if (!normalizedSubject || !normalizedCategoryId) throw new Error('商品查询缺少标题或类目');
  if (!Number.isInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 30) {
    throw new Error('商品查询每页数量必须是 1 到 30');
  }
  const body = await callAlibabaApi(config, 'alibaba.icbu.product.list', {
    subject: normalizedSubject,
    category_id: normalizedCategoryId,
    language: 'ENGLISH',
    gmt_modified_from: formatDateTime(modifiedFrom),
    gmt_modified_to: formatDateTime(modifiedTo),
    current_page: 1,
    page_size: normalizedPageSize,
  }, fetchImpl, timestamp);
  const response = body.alibaba_icbu_product_list_response || body;
  const products = Array.isArray(response.products)
    ? response.products
    : Array.isArray(response.result?.products) ? response.result.products : [];
  return {
    products: products.map((product) => ({
      productId: String(product.product_id ?? product.id ?? '').trim(),
      subject: String(product.subject || ''),
      categoryId: String(product.category_id || ''),
      status: String(product.status || ''),
      display: String(product.display || ''),
      modifiedAt: String(product.gmt_modified || ''),
    })).filter((product) => /^\d+$/.test(product.productId)),
    requestId: body.request_id || response.request_id || '',
  };
}

export { DEFAULT_GATEWAY };
