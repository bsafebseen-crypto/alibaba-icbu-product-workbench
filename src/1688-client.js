import crypto from 'node:crypto';

const DEFAULT_GATEWAY = 'https://gw.open.1688.com';
const DEFAULT_AUTHORIZE_URL = 'https://auth.1688.com/oauth/authorize';

function requireHttps(value, label) {
  if (!/^https:\/\//i.test(value)) throw new Error(`${label}必须使用 HTTPS 地址`);
}

export function normalize1688Config(config = {}, options = {}) {
  const normalized = {
    gatewayUrl: String(config.gatewayUrl || DEFAULT_GATEWAY).trim().replace(/\/+$/, ''),
    authorizeUrl: String(config.authorizeUrl || DEFAULT_AUTHORIZE_URL).trim(),
    appKey: String(config.appKey || '').trim(),
    appSecret: String(config.appSecret || '').trim(),
    accessToken: String(config.accessToken || '').trim(),
    redirectUri: String(config.redirectUri || '').trim(),
    appName: String(config.appName || '').trim(),
  };
  const required = [
    ['App Key', normalized.appKey],
    ...(options.secret === false ? [] : [['App Secret', normalized.appSecret]]),
    ...(options.token ? [['Access Token', normalized.accessToken]] : []),
    ...(options.redirect ? [['回调地址', normalized.redirectUri]] : []),
  ];
  const missing = required.filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) throw new Error(`请填写 1688 ${missing.join('、')}`);
  requireHttps(normalized.gatewayUrl, '1688 网关');
  requireHttps(normalized.authorizeUrl, '1688 授权地址');
  if (normalized.redirectUri) requireHttps(normalized.redirectUri, '1688 回调地址');
  return normalized;
}

function encodeValue(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return String(value);
}

function normalizeParams(params = {}) {
  return Object.fromEntries(Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, encodeValue(value)]));
}

export function sign1688Request(apiPath, params, appSecret, excludedKeys = []) {
  const excluded = new Set(excludedKeys);
  const suffix = Object.keys(params)
    .filter((key) => !excluded.has(key) && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${encodeValue(params[key])}`)
    .join('');
  return crypto
    .createHmac('sha1', appSecret)
    .update(`${String(apiPath).replace(/^\/+/, '')}${suffix}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export function build1688AuthorizeUrl(config, state) {
  const credentials = normalize1688Config(config, { secret: false, redirect: true });
  const url = new URL(credentials.authorizeUrl);
  url.searchParams.set('client_id', credentials.appKey);
  url.searchParams.set('site', '1688');
  url.searchParams.set('redirect_uri', credentials.redirectUri);
  if (state) url.searchParams.set('state', String(state));
  return url.toString();
}

function safeTokenResult(body, fallbackRefreshToken = '') {
  if (!body?.access_token) throw createSafeError(body, 200, {}, false, '1688 授权成功，但接口没有返回 Access Token');
  return {
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token || fallbackRefreshToken),
    expiresIn: Number(body.expires_in),
    refreshTokenTimeout: body.refresh_token_timeout || '',
    memberId: body.memberId || body.member_id || '',
  };
}

function redact(value, secrets = {}) {
  let result = String(value || '');
  for (const secret of Object.values(secrets)) {
    if (secret) result = result.split(String(secret)).join('[已隐藏]');
  }
  return result;
}

function createSafeError(body, status, secrets, uncertain = false, fallback = '') {
  const rawCode = body?.error_code || body?.errorCode || body?.code || '';
  const rawMessage = body?.error_message || body?.errorMsg || body?.message || body?.exception || fallback;
  const tokenInvalid = String(rawCode) === '401' || /access[_ ]?token.*(?:invalid|expire)|invalid.*access[_ ]?token/i.test(String(rawMessage));
  const message = tokenInvalid
    ? '1688 授权令牌无效或已过期，请刷新授权后重试'
    : redact(rawMessage || `1688 接口请求失败（HTTP ${status}）`, secrets);
  const error = new Error(message);
  error.code = String(rawCode || status || '1688_API_ERROR');
  error.requestId = String(body?.request_id || body?.requestId || '');
  error.uncertain = Boolean(uncertain);
  return error;
}

async function postToken(config, path, params, fetchImpl) {
  const credentials = normalize1688Config(config, { redirect: params.grant_type === 'authorization_code' });
  const body = new URLSearchParams(normalizeParams(params));
  let response;
  try {
    response = await fetchImpl(`${credentials.gatewayUrl}${path}/${encodeURIComponent(credentials.appKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    });
  } catch {
    throw new Error('1688 授权服务连接失败，请检查网络后重试');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error || result.error_code) {
    throw createSafeError(result, response.status, credentials);
  }
  return result;
}

export async function exchange1688Code(config, code, fetchImpl = fetch) {
  const credentials = normalize1688Config(config, { redirect: true });
  const authorizationCode = String(code || '').trim();
  if (!authorizationCode) throw new Error('请填写 1688 返回的授权码');
  const body = await postToken(credentials, '/openapi/http/1/system.oauth2/getToken', {
    grant_type: 'authorization_code',
    need_refresh_token: true,
    client_id: credentials.appKey,
    client_secret: credentials.appSecret,
    redirect_uri: credentials.redirectUri,
    code: authorizationCode,
  }, fetchImpl);
  return safeTokenResult(body);
}

export async function refresh1688Token(config, refreshToken, fetchImpl = fetch) {
  const credentials = normalize1688Config(config);
  const token = String(refreshToken || '').trim();
  if (!token) throw new Error('没有可用于刷新的 1688 Refresh Token');
  const body = await postToken(credentials, '/openapi/param2/1/system.oauth2/getToken', {
    grant_type: 'refresh_token',
    client_id: credentials.appKey,
    client_secret: credentials.appSecret,
    refresh_token: token,
  }, fetchImpl);
  return safeTokenResult(body, token);
}

export async function call1688Api(config, api, fetchImpl = fetch) {
  const credentials = normalize1688Config(config, { token: api.requiresToken !== false });
  const version = Number(api.version || 1);
  const namespace = String(api.namespace || '').trim();
  const name = String(api.name || '').trim();
  if (!/^[a-z0-9.]+$/i.test(namespace) || !/^[a-z0-9.]+$/i.test(name)) {
    throw new Error('1688 API 名称或命名空间无效');
  }
  const apiPath = `param2/${version}/${namespace}/${name}/${credentials.appKey}`;
  const params = normalizeParams({
    ...(api.requiresToken === false ? {} : { access_token: credentials.accessToken }),
    ...(api.params || {}),
  });
  params._aop_signature = sign1688Request(
    apiPath,
    params,
    credentials.appSecret,
    api.signatureExclusions || [],
  );
  let response;
  try {
    response = await fetchImpl(`${credentials.gatewayUrl}/openapi/${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    if (api.write) {
      throw createSafeError({}, 0, credentials, true, '1688 写接口连接中断，结果不确定；系统不会自动重发，只能进行只读核验');
    }
    throw new Error('1688 接口连接失败，请检查网络后重试');
  }
  const body = await response.json().catch(() => ({}));
  const hasTopLevelError = body.error_code || body.error || body.exception
    || (body.errorCode && body.success === false);
  if (!response.ok || hasTopLevelError) {
    throw createSafeError(body, response.status, credentials, Boolean(api.write && response.status >= 500));
  }
  return body;
}

export function search1688Categories(config, keyword, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.category.searchByKeyword',
    params: { keyword: String(keyword || '').trim() },
  }, fetchImpl);
}

export function get1688Category(config, categoryId, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.category.get',
    params: { categoryID: categoryId },
    requiresToken: false,
  }, fetchImpl);
}

export function get1688ProductSchema(config, params, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.new.product.getSchema',
    params,
  }, fetchImpl);
}

export function get1688ProductSubSchema(config, params, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.new.product.getSubSchema',
    params: { ...params, dataBody: encodeValue(params.dataBody) },
  }, fetchImpl);
}

export function list1688Products(config, params, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.product.list.get',
    params,
  }, fetchImpl);
}

export function get1688Product(config, productId, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.product.get',
    params: { productID: String(productId) },
  }, fetchImpl);
}

export function upload1688Photo(config, image, fetchImpl = fetch) {
  return call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.photobank.photo.add',
    params: {
      albumID: image.albumId,
      name: image.name,
      description: image.description,
      drawTxt: image.drawTxt,
      imageBytes: Buffer.isBuffer(image.bytes) ? image.bytes.toString('base64') : image.bytes,
      webSite: '1688',
    },
    signatureExclusions: ['imageBytes'],
    write: true,
  }, fetchImpl);
}

export async function publish1688Product(config, product, fetchImpl = fetch) {
  const body = await call1688Api(config, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.new.product.add',
    params: {
      catId: product.catId,
      scene: product.scene,
      dataBody: encodeValue(product.dataBody),
      bizParam: product.bizParam,
      productSourceChannels: product.productSourceChannels,
    },
    write: true,
  }, fetchImpl);
  const result = body.result || {};
  if (result.success !== true) {
    throw createSafeError({
      errorCode: result.bizCode || '1688_PUBLISH_FAILED',
      errorMsg: result.bizMsg || '1688 商品发布失败',
      request_id: body.request_id,
    }, 200, normalize1688Config(config));
  }
  let rawData = result.bizData?.dataJson || result.bizData || {};
  if (typeof rawData === 'string') {
    try { rawData = JSON.parse(rawData); } catch { rawData = {}; }
  }
  return {
    success: true,
    bizCode: String(result.bizCode || ''),
    bizMsg: String(result.bizMsg || ''),
    itemId: rawData.itemId === undefined ? undefined : String(rawData.itemId),
    offerStatus: rawData.offerStatus,
    qualityScore: rawData.qualityScore,
    categoryId: rawData.categoryId,
    requestId: String(body.request_id || body.requestId || ''),
    rawData,
  };
}
