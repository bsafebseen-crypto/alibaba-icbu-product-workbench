import { signAlibabaParams } from './alibaba-client.js';

const METHODS = Object.freeze({
  conversations: 'alibaba.interaction.im.conversation.list.query',
  messages: 'alibaba.interaction.im.message.list.query',
});

function inquiryError(code, message = '阿里询盘接口请求失败', status) {
  const error = new Error(message);
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

function requireConfig(config = {}) {
  const gatewayUrl = String(config.inquiryGatewayUrl || 'https://eco.taobao.com/router/rest').trim().replace(/\/+$/, '');
  const appKey = String(config.appKey || '').trim();
  const appSecret = String(config.appSecret || '').trim();
  if (!/^https:\/\//i.test(gatewayUrl)) throw new Error('询盘网关必须使用 HTTPS');
  if (!appKey || !appSecret) throw new Error('请填写 App Key 和 App Secret');
  return { gatewayUrl, appKey, appSecret };
}

function id(value, name) {
  if (typeof value !== 'string') throw new Error(`${name}必须是字符串`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}不能为空`);
  if (normalized.length > 128) throw new Error(`${name}长度不能超过 128 个字符`);
  return normalized;
}

function optionalTimestamp(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('时间戳必须是数字字符串');
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('时间戳必须是数字字符串');
  return normalized;
}

function commonInput(input = {}) {
  const count = input.count === undefined ? undefined : Number(input.count);
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 50)) {
    throw new Error('count 必须是 1 到 50 的整数');
  }
  const forward = input.forward === undefined ? undefined : input.forward;
  if (forward !== undefined && typeof forward !== 'boolean') throw new Error('forward 必须是布尔值');
  return {
    ...(count === undefined ? {} : { count }),
    ...(optionalTimestamp(input.limitTimestamp) === undefined ? {} : { limit_timestamp: optionalTimestamp(input.limitTimestamp) }),
    ...(forward === undefined ? {} : { forward }),
  };
}

function classifyInquiryError(payload = {}, httpStatus = 200) {
  const source = `${payload.code || ''} ${payload.sub_code || ''} ${payload.msg || ''}`.toLowerCase();
  let code = 'api_error';
  if (/permission|unauthor|access[._-]?denied/.test(source)) code = 'permission_denied';
  else if (/sign|signature/.test(source)) code = 'signature_error';
  else if (/flow|limit|thrott|frequency/.test(source) || httpStatus === 429) code = 'rate_limited';
  else if (/account|seller/.test(source) && /invalid|not[._-]?exist|illegal/.test(source)) code = 'invalid_account';
  else if (httpStatus >= 400) code = 'http_error';
  return inquiryError(code, code === 'permission_denied' ? '当前阿里应用没有询盘读取权限' : '阿里询盘接口请求失败', httpStatus);
}

async function callReadMethod(config, method, apiParams, fetchImpl, timestamp) {
  if (!Object.values(METHODS).includes(method)) throw new Error('询盘接口不在只读允许列表');
  const value = requireConfig(config);
  const params = {
    app_key: value.appKey, format: 'json', method, sign_method: 'sha256',
    timestamp: String(timestamp), v: '2.0', ...apiParams,
  };
  params.sign = signAlibabaParams(params, value.appSecret);
  let response;
  try {
    response = await fetchImpl(value.gatewayUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8' }, body: JSON.stringify(params),
    });
  } catch {
    throw inquiryError('http_error');
  }
  const body = await response.json().catch(() => ({}));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw inquiryError('malformed_response', '阿里询盘接口返回格式无效');
  }
  if (!response.ok || body.error_response) throw classifyInquiryError(body.error_response, response.status);
  return body;
}

function resultFor(body, method) {
  const wrapper = body[method.replaceAll('.', '_') + '_response'];
  const response = wrapper;
  if (!response || !response.result || !Array.isArray(response.result[method === METHODS.conversations ? 'conversation_list' : 'message_list'])) {
    throw inquiryError('malformed_response', '阿里询盘接口返回格式无效');
  }
  return { response, result: response.result, requestId: response.request_id || body.request_id || '' };
}

export function normalizeConversation(item = {}) {
  return {
    conversationId: String(item.conversation_id ?? ''),
    latestMessageTime: item.latest_message_time ?? '',
    buyerAccountId: String(item.buyer_account_id ?? item.buyer_account?.account_id ?? ''),
    buyerDisplayName: String(item.buyer_display_name ?? item.buyer_account?.display_name ?? ''),
    lastMessagePreview: String(item.last_message_preview ?? item.last_message?.content ?? ''),
  };
}

export function normalizeMessage(item = {}, selfAccountId) {
  const sender = String(item.sender_account_id ?? '');
  return {
    messageId: String(item.message_id ?? ''), conversationId: String(item.conversation_id ?? ''),
    sendTime: item.send_time ?? '', senderAccountId: sender,
    receiverAccountId: String(item.receiver_account_id ?? ''),
    direction: sender === selfAccountId ? 'seller' : 'buyer',
    content: String(item.content ?? ''), messageType: String(item.message_type ?? ''),
  };
}

export async function queryConversations(config, input = {}, fetchImpl = fetch, timestamp = Date.now()) {
  const sellerAccountId = id(input.sellerAccountId, 'sellerAccountId');
  const body = await callReadMethod(config, METHODS.conversations, {
    seller_account_id: sellerAccountId, ...commonInput(input),
  }, fetchImpl, timestamp);
  const { result, requestId } = resultFor(body, METHODS.conversations);
  return { items: result.conversation_list.map(normalizeConversation), nextTimestamp: result.next_time_stamp ?? '', hasMore: result.has_more === true || result.has_more === 'true', requestId };
}

export async function queryMessages(config, input = {}, fetchImpl = fetch, timestamp = Date.now()) {
  const conversationId = id(input.conversationId, 'conversationId');
  const selfAccountId = id(input.selfAccountId, 'selfAccountId');
  const body = await callReadMethod(config, METHODS.messages, {
    conversation_id: conversationId, self_account_id: selfAccountId, ...commonInput(input),
  }, fetchImpl, timestamp);
  const { result, requestId } = resultFor(body, METHODS.messages);
  return { items: result.message_list.map((item) => normalizeMessage(item, selfAccountId)), nextTimestamp: result.next_time_stamp ?? '', hasMore: result.has_more === true || result.has_more === 'true', requestId };
}

export async function probeInquiryCapability(config, sellerAccountId, fetchImpl = fetch, timestamp = Date.now()) {
  const result = await queryConversations(config, { sellerAccountId, count: 1 }, fetchImpl, timestamp);
  return { ok: true, empty: result.items.length === 0, accountId: id(sellerAccountId, 'sellerAccountId') };
}

export { classifyInquiryError };
