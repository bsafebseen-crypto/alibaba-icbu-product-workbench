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
  if (!response.ok) throw new Error(body?.error_response?.msg || `阿里接口请求失败（HTTP ${response.status}）`);
  if (body.error_response) {
    const error = new Error(body.error_response.msg || body.error_response.sub_msg || '阿里接口返回错误');
    error.code = body.error_response.code || body.error_response.sub_code;
    error.requestId = body.error_response.request_id;
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
  const secretId = String(encrypted.secret_id || '').trim();
  if (!secretId) throw new Error('阿里未返回可读取商品详情的加密 ID');

  const productBody = await callAlibabaApi(config, 'alibaba.icbu.product.get', {
    product_id: secretId,
    language: 'ENGLISH',
  }, fetchImpl, timestamp);
  const product = productBody.product || {};
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

export { DEFAULT_GATEWAY };
