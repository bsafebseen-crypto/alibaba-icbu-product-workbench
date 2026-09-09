import test from 'node:test';
import assert from 'node:assert/strict';

import {
  callAlibabaApi,
  createAlibabaProduct,
  createAlibabaProductDraft,
  exchangeAlibabaCode,
  getAlibabaPublishingCapability,
  loadAlibabaProductDraft,
  loadAlibabaProductContext,
  loadAlibabaProductTemplate,
  listAlibabaProducts,
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
    {
      code: '0',
      request_id: 'encrypt-request',
      alibaba_icbu_product_id_encrypt_response: {
        secret_id: 'encrypted-product-id',
      },
    },
    {
      code: '0',
      request_id: 'product-request',
      alibaba_icbu_product_get_response: {
        product: {
          product_id: 'encrypted-product-id',
          category_id: '32905',
          language: 'ENGLISH',
          product_type: 'sourcing',
        },
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

test('loadAlibabaProductContext surfaces an encrypt business error', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: '15',
        message: 'The product ID is unavailable',
        request_id: 'encrypt-failed-request',
      };
    },
  });

  await assert.rejects(
    () => loadAlibabaProductContext({
      gatewayUrl: 'https://gateway.example.com',
      appKey: '511556',
      appSecret: 'secret',
      accessToken: 'token',
    }, { productId: '1601933369105' }, fetchImpl, 1700000000000),
    /The product ID is unavailable.*15/,
  );
});

test('getAlibabaPublishingCapability reads source and wholesale permissions', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          request_id: 'capability-request',
          alibaba_icbu_product_type_available_get_response: {
            result: { support_post_sourcing: true, support_post_whole_sale: false },
          },
        };
      },
    };
  };

  const result = await getAlibabaPublishingCapability({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, { categoryId: '32905', language: 'en_US' }, fetchImpl, 1700000000000);

  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.type.available.get');
  assert.deepEqual(JSON.parse(request.body.type_request), {
    cat_id: '32905',
    language: 'en_US',
  });
  assert.equal(request.body.cat_id, undefined);
  assert.equal(request.body.language, undefined);
  assert.deepEqual(result, {
    supportPostSourcing: true,
    supportPostWholesale: false,
    requestId: 'capability-request',
  });
});

test('createAlibabaProductDraft sends the official schema draft envelope', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          request_id: 'draft-request',
          alibaba_icbu_product_schema_add_draft_response: {
            biz_success: true,
            product_id: '987654321',
            trace_id: 'draft-trace',
            message: '',
            msg_code: '',
          },
        };
      },
    };
  };

  const result = await createAlibabaProductDraft({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, {
    schemaXml: '<itemSchema />',
    publishContext: { categoryId: '32905', language: 'en_US', publishType: 'default', version: 'trade.1.1' },
  }, fetchImpl, 1700000000000);

  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.add.draft');
  assert.deepEqual(JSON.parse(request.body.param_product_top_publish_request), {
    publish_type: 'default',
    xml: '<itemSchema />',
    cat_id: '32905',
    language: 'en_US',
    version: 'trade.1.1',
  });
  assert.deepEqual(result, {
    bizSuccess: true,
    productId: '987654321',
    message: '',
    msgCode: '',
    traceId: 'draft-trace',
    requestId: 'draft-request',
  });
});

test('createAlibabaProductDraft marks explicit Alibaba business failures as definitive', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() { return { biz_success: false, msg_code: 'INVALID', message: 'bad field', trace_id: 'trace' }; },
  });
  await assert.rejects(
    () => createAlibabaProductDraft({
      gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
    }, {
      schemaXml: '<itemSchema />',
      publishContext: { categoryId: '32905', language: 'en_US', publishType: 'default', version: 'trade.1.1' },
    }, fetchImpl, 1700000000000),
    (error) => error.code === 'INVALID' && error.definitive === true && error.traceId === 'trace',
  );
});

test('callAlibabaApi preserves Alibaba error metadata on a non-2xx response', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    async json() {
      return { error_response: { msg: 'Remote service error', code: '15', sub_code: 'isp.remote-service-error', request_id: 'request-failed' } };
    },
  });

  await assert.rejects(
    () => callAlibabaApi({
      gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
    }, 'alibaba.icbu.product.list', {}, fetchImpl),
    (error) => error.message === 'Remote service error'
      && error.code === '15'
      && error.subCode === 'isp.remote-service-error'
      && error.requestId === 'request-failed',
  );
});

test('createAlibabaProduct sends the official schema add envelope', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true, status: 200,
      async json() {
        return {
          request_id: 'publish-request',
          alibaba_icbu_product_schema_add_response: {
            biz_success: true, product_id: '1601999000001', trace_id: 'publish-trace',
          },
        };
      },
    };
  };

  const result = await createAlibabaProduct({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, {
    schemaXml: '<itemSchema />',
    publishContext: {
      categoryId: '301504', language: 'en_US', publishType: 'default', version: 'trade.1.1',
    },
  }, fetchImpl, 1700000000000);

  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.add');
  assert.deepEqual(JSON.parse(request.body.param_product_top_publish_request), {
    publish_type: 'default', xml: '<itemSchema />', cat_id: '301504',
    language: 'en_US', version: 'trade.1.1',
  });
  assert.deepEqual(result, {
    productId: '1601999000001', traceId: 'publish-trace', requestId: 'publish-request',
  });
});

test('createAlibabaProduct marks explicit business rejection as definitive', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    async json() {
      return {
        alibaba_icbu_product_schema_add_response: {
          biz_success: false, msg_code: 'INVALID_FIELD', message: 'bad field', trace_id: 'trace-reject',
        },
      };
    },
  });

  await assert.rejects(
    () => createAlibabaProduct({
      gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
    }, {
      schemaXml: '<itemSchema />',
      publishContext: { categoryId: '301504', language: 'en_US', publishType: 'default' },
    }, fetchImpl, 1700000000000),
    (error) => error.definitive === true
      && error.code === 'INVALID_FIELD'
      && error.traceId === 'trace-reject',
  );
});

test('listAlibabaProducts maps schema language and returns safe product summaries', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true, status: 200,
      async json() {
        return {
          request_id: 'list-request',
          alibaba_icbu_product_list_response: {
            products: [{
              id: 1601999000001,
              subject: 'Exact Product Title',
              category_id: 301504,
              status: 'auditing',
              display: 'N',
              gmt_modified: '2026-09-08 14:00:00',
              secret: 'must-not-return',
            }],
          },
        };
      },
    };
  };

  const result = await listAlibabaProducts({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, {
    subject: 'Exact Product Title', categoryId: '301504',
    modifiedFrom: '2026-09-08 13:59:00', modifiedTo: '2026-09-08 14:10:00', pageSize: 30,
  }, fetchImpl, 1700000000000);

  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.list');
  assert.deepEqual(request.body, {
    app_key: 'key', session: 'token', method: 'alibaba.icbu.product.list',
    v: '2.0', format: 'json', sign_method: 'sha256', timestamp: '1700000000000',
    subject: 'Exact Product Title', category_id: '301504', language: 'ENGLISH',
    gmt_modified_from: '2026-09-08 13:59:00', gmt_modified_to: '2026-09-08 14:10:00',
    current_page: '1', page_size: '30', sign: request.body.sign,
  });
  assert.deepEqual(result, {
    products: [{
      productId: '1601999000001', subject: 'Exact Product Title', categoryId: '301504',
      status: 'auditing', display: 'N', modifiedAt: '2026-09-08 14:00:00',
    }],
    requestId: 'list-request',
  });
});

test('listAlibabaProducts converts ISO timestamps to the Alibaba date-time format', async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() { return { alibaba_icbu_product_list_response: { products: [] } }; },
    };
  };

  await listAlibabaProducts({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, {
    subject: 'Exact Product Title', categoryId: '301504',
    modifiedFrom: '2026-09-08T06:00:00.000Z', modifiedTo: '2026-09-09T06:00:00.000Z',
  }, fetchImpl, 1700000000000);

  assert.equal(requestBody.gmt_modified_from, '2026-09-08 06:00:00');
  assert.equal(requestBody.gmt_modified_to, '2026-09-09 06:00:00');
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

test('loadAlibabaProductDraft sends the official read-only draft render envelope', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          request_id: 'request-1',
          alibaba_icbu_product_schema_render_draft_response: {
            biz_success: true,
            data: '<itemSchema />',
            trace_id: 'trace-1',
          },
        };
      },
    };
  };

  const result = await loadAlibabaProductDraft({
    gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
  }, {
    productId: '1601933441594', categoryId: '301504', language: 'en_US',
  }, fetchImpl, 1700000000000);

  assert.equal(request.url, 'https://gateway.example.com/sync?method=alibaba.icbu.product.schema.render.draft');
  assert.deepEqual(JSON.parse(request.body.param_product_top_publish_request), {
    product_id: '1601933441594',
    cat_id: '301504',
    language: 'en_US',
  });
  assert.deepEqual(result, {
    productId: '1601933441594',
    schemaXml: '<itemSchema />',
    traceId: 'trace-1',
    requestId: 'request-1',
  });
});

test('loadAlibabaProductDraft preserves safe Alibaba failure metadata', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        alibaba_icbu_product_schema_render_draft_response: {
          biz_success: false,
          message: 'draft not found',
          msg_code: 'NOT_FOUND',
          trace_id: 'trace-missing',
        },
      };
    },
  });

  await assert.rejects(
    () => loadAlibabaProductDraft({
      gatewayUrl: 'https://gateway.example.com', appKey: 'key', appSecret: 'secret', accessToken: 'token',
    }, {
      productId: '1601933441594', categoryId: '301504', language: 'en_US',
    }, fetchImpl, 1700000000000),
    (error) => error.message === 'draft not found'
      && error.code === 'NOT_FOUND'
      && error.traceId === 'trace-missing',
  );
});
