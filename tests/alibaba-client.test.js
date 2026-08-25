import test from 'node:test';
import assert from 'node:assert/strict';

import {
  callAlibabaApi,
  exchangeAlibabaCode,
  loadAlibabaProductContext,
  loadAlibabaProductTemplate,
  refreshAlibabaToken,
  signAlibabaGopRequest,
  signAlibabaParams,
  testAlibabaConnection,
  uploadAlibabaPhoto,
} from '../src/alibaba-client.js';

test('signAlibabaParams matches the official SDK HMAC-SHA256 parameter order', () => {
  const signature = signAlibabaParams({
    app_key: '511556',
    timestamp: '1700000000000',
    access_token: 'token',
    sign_method: 'sha256',
    foo: 'bar',
  }, 'secret');

  assert.equal(signature, 'DE29031D92E7FB47935F9E9C9BBA94593F4F9694A77D7F61656C5B7CADA5239A');
});

test('signAlibabaGopRequest prefixes the API path before sorted parameters', () => {
  const signature = signAlibabaGopRequest('/auth/token/create', {
    app_key: '511556',
    code: 'auth-code',
    sign_method: 'sha256',
    timestamp: '1700000000000',
  }, 'secret');

  assert.equal(signature, '1241E155DA6F2A1D35BFB8DEB96FC07DA525F1B87BC5807274543FE0EEC976CF');
});

test('exchangeAlibabaCode posts a signed GOP request and returns OAuth tokens', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          refresh_expires_in: 2592000,
        };
      },
    };
  };

  const result = await exchangeAlibabaCode({
    gatewayUrl: 'https://gateway.example.com/',
    appKey: '511556',
    appSecret: 'never-send-me',
  }, 'auth-code', fetchImpl, 1700000000000);

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/rest/auth/token/create');
  assert.equal(body.app_key, '511556');
  assert.equal(body.code, 'auth-code');
  assert.equal(body.sign_method, 'sha256');
  assert.match(body.sign, /^[A-F0-9]{64}$/);
  assert.equal(JSON.stringify(body).includes('never-send-me'), false);
  assert.equal(result.accessToken, 'new-access-token');
  assert.equal(result.refreshToken, 'new-refresh-token');
  assert.equal(result.expiresIn, 3600);
});

test('refreshAlibabaToken uses the refresh token endpoint', async () => {
  let requestUrl;
  const fetchImpl = async (url) => {
    requestUrl = url;
    return {
      ok: true,
      status: 200,
      async json() { return { access_token: 'renewed', refresh_token: 'rotated' }; },
    };
  };

  const result = await refreshAlibabaToken({
    gatewayUrl: 'https://gateway.example.com',
    appKey: '511556',
    appSecret: 'secret',
  }, 'refresh-token', fetchImpl, 1700000000000);

  assert.equal(requestUrl, 'https://gateway.example.com/rest/auth/token/refresh');
  assert.equal(result.accessToken, 'renewed');
  assert.equal(result.refreshToken, 'rotated');
});

test('callAlibabaApi posts a signed TOP request without leaking the app secret', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() { return { code: '0', request_id: 'request-1' }; },
    };
  };

  const result = await callAlibabaApi({
    gatewayUrl: 'https://gateway.example.com/',
    appKey: '511556',
    appSecret: 'never-send-me',
    accessToken: 'access-token',
  }, 'alibaba.icbu.product.schema.get', {
    param_product_top_publish_request: { cat_id: 333, language: 'zh' },
  }, fetchImpl, 1700000000000);

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.get');
  assert.equal(request.options.headers['Content-Type'], 'application/json;charset=utf-8');
  assert.equal(body.app_key, '511556');
  assert.equal(body.v, '2.0');
  assert.equal(body.method, 'alibaba.icbu.product.schema.get');
  assert.equal(body.format, 'json');
  assert.equal(body.session, 'access-token');
  assert.equal(body.sign_method, 'sha256');
  assert.equal(body.access_token, undefined);
  assert.match(body.param_product_top_publish_request, /^\{/);
  assert.equal(JSON.stringify(body).includes('never-send-me'), false);
  assert.equal(result.request_id, 'request-1');
});

test('testAlibabaConnection accepts an authenticated business response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: '0',
        request_id: 'request-2',
        alibaba_icbu_product_schema_get_response: {
          biz_success: true,
          trace_id: 'trace-1',
        },
      };
    },
  });

  const result = await testAlibabaConnection({
    gatewayUrl: 'https://gateway.example.com',
    appKey: '511556',
    appSecret: 'secret',
    accessToken: 'token',
  }, fetchImpl);

  assert.deepEqual(result, {
    ok: true,
    message: '阿里接口签名和授权验证成功',
    requestId: 'request-2',
    traceId: 'trace-1',
  });
});

test('loadAlibabaProductTemplate reads an existing product schema without changing it', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          request_id: 'request-template',
          alibaba_icbu_product_schema_render_response: {
            biz_success: true,
            data: '<itemSchema><field id="subject" /></itemSchema>',
            trace_id: 'trace-template',
          },
        };
      },
    };
  };

  const result = await loadAlibabaProductTemplate({
    gatewayUrl: 'https://gateway.example.com',
    appKey: '511556',
    appSecret: 'secret',
    accessToken: 'token',
  }, '1601915922577', fetchImpl, 1700000000000);

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.render');
  assert.deepEqual(JSON.parse(body.param_product_top_publish_request), {
    publish_type: 'default',
    product_id: '1601915922577',
    language: 'zh',
    version: 'trade.1.1',
  });
  assert.deepEqual(result, {
    sourceProductId: '1601915922577',
    schemaXml: '<itemSchema><field id="subject" /></itemSchema>',
    requestId: 'request-template',
    traceId: 'trace-template',
  });
});

test('loadAlibabaProductContext resolves category and source type before rendering schema', async () => {
  const requests = [];
  const responses = [
    { code: '0', request_id: 'encrypt-request', secret_id: 'encrypted-product-id' },
    {
      code: '0',
      request_id: 'product-request',
      product: {
        product_id: 'encrypted-product-id',
        category_id: '32905',
        language: 'ENGLISH',
        product_type: 'sourcing',
      },
    },
    {
      code: '0',
      request_id: 'render-request',
      alibaba_icbu_product_schema_render_response: {
        biz_success: true,
        data: '<itemSchema><field id="subject" /></itemSchema>',
        trace_id: 'render-trace',
      },
    },
  ];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const body = responses.shift();
    return { ok: true, status: 200, async json() { return body; } };
  };

  const result = await loadAlibabaProductContext({
    gatewayUrl: 'https://gateway.example.com',
    appKey: '511556',
    appSecret: 'secret',
    accessToken: 'token',
  }, { productId: '1601915922577' }, fetchImpl, 1700000000000);

  assert.deepEqual(requests.map(({ url }) => url), [
    'https://gateway.example.com/sync?method=alibaba.icbu.product.id.encrypt',
    'https://gateway.example.com/sync?method=alibaba.icbu.product.get',
    'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.render',
  ]);
  assert.equal(requests[0].body.language, 'ENGLISH');
  assert.equal(requests[0].body.product_id, '1601915922577');
  assert.equal(requests[1].body.product_id, 'encrypted-product-id');
  assert.equal(requests[1].body.language, 'ENGLISH');
  assert.deepEqual(JSON.parse(requests[2].body.param_product_top_publish_request), {
    publish_type: 'default',
    product_id: '1601915922577',
    cat_id: '32905',
    language: 'en_US',
    version: 'trade.1.1',
  });
  assert.deepEqual(result, {
    sourceProductId: '1601915922577',
    sourceProductType: 'sourcing',
    categoryId: '32905',
    language: 'en_US',
    publishType: 'default',
    version: 'trade.1.1',
    schemaXml: '<itemSchema><field id="subject" /></itemSchema>',
    requestId: 'render-request',
    traceId: 'render-trace',
  });
});

test('loadAlibabaProductContext blocks when product details omit the category', async () => {
  const responses = [
    { code: '0', secret_id: 'encrypted-product-id' },
    { code: '0', product: { product_type: 'sourcing', language: 'ENGLISH' } },
  ];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() { return responses.shift(); },
  });

  await assert.rejects(
    () => loadAlibabaProductContext({
      gatewayUrl: 'https://gateway.example.com',
      appKey: '511556',
      appSecret: 'secret',
      accessToken: 'token',
    }, { productId: '1601915922577' }, fetchImpl, 1700000000000),
    /无法从源商品确定类目 ID/,
  );
});

test('uploadAlibabaPhoto sends the official multipart TOP request and normalizes the result', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          request_id: 'request-photo',
          alibaba_icbu_photobank_upload_response: {
            upload_image_response: {
              file_name: 'generated.jpg',
              file_id: '73826382',
              photobank_url: 'https://img.alicdn.com/generated.jpg',
            },
          },
        };
      },
    };
  };

  const result = await uploadAlibabaPhoto({
    gatewayUrl: 'https://gateway.example.com/',
    appKey: '511556',
    appSecret: 'never-send-me',
    accessToken: 'access-token',
  }, {
    fileName: 'main-image.jpg',
    mimeType: 'image/jpeg',
    imageBytes: Buffer.from([1, 2, 3]),
    groupId: '17590',
  }, fetchImpl, 1700000000000);

  const form = request.options.body;
  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.photobank.upload');
  assert.equal(request.options.headers, undefined);
  assert.equal(form.get('app_key'), '511556');
  assert.equal(form.get('method'), 'alibaba.icbu.photobank.upload');
  assert.equal(form.get('session'), 'access-token');
  assert.equal(form.get('file_name'), 'main-image.jpg');
  assert.equal(form.get('group_id'), '17590');
  assert.equal(form.get('extra_context'), '{}');
  assert.match(form.get('sign'), /^[A-F0-9]{64}$/);
  assert.equal(form.get('image_bytes').size, 3);
  assert.equal(form.get('image_bytes').type, 'image/jpeg');
  assert.equal([...form.values()].some((value) => String(value).includes('never-send-me')), false);
  assert.deepEqual(result, {
    fileName: 'generated.jpg',
    fileId: '73826382',
    photobankUrl: 'https://img.alicdn.com/generated.jpg',
    requestId: 'request-photo',
  });
});

test('uploadAlibabaPhoto rejects empty or unsupported image data before calling Alibaba', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  const config = {
    gatewayUrl: 'https://gateway.example.com',
    appKey: '511556',
    appSecret: 'secret',
    accessToken: 'token',
  };

  await assert.rejects(
    uploadAlibabaPhoto(config, {
      fileName: 'bad.svg',
      mimeType: 'image/svg+xml',
      imageBytes: Buffer.from('<svg />'),
    }, fetchImpl),
    /仅支持 JPG、PNG 或 WebP 图片/,
  );
  await assert.rejects(
    uploadAlibabaPhoto(config, {
      fileName: 'empty.jpg',
      mimeType: 'image/jpeg',
      imageBytes: Buffer.alloc(0),
    }, fetchImpl),
    /图片内容为空/,
  );
  assert.equal(calls, 0);
});
