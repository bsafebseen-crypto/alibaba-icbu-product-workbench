import test from 'node:test';
import assert from 'node:assert/strict';

import {
  build1688AuthorizeUrl,
  call1688Api,
  exchange1688Code,
  get1688Category,
  get1688Product,
  get1688ProductSchema,
  get1688ProductSubSchema,
  list1688Products,
  publish1688Product,
  refresh1688Token,
  search1688Categories,
  sign1688Request,
  upload1688Photo,
} from '../src/1688-client.js';

const baseConfig = {
  gatewayUrl: 'https://gateway.example.com/',
  authorizeUrl: 'https://auth.example.com/oauth/authorize',
  appKey: '1000000',
  appSecret: 'test123',
  accessToken: 'access-token',
  redirectUri: 'https://workbench.example.com/oauth/1688/callback',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('sign1688Request matches the documented param2 HMAC-SHA1 example', () => {
  assert.equal(
    sign1688Request('param2/1/system/currentTime/1000000', { b: 2, a: 1 }, 'test123'),
    '33E54F4F7B989E3E0E912D3FBD2F1A03CA7CCE88',
  );
});

test('build1688AuthorizeUrl uses a separate 1688 OAuth endpoint and callback', () => {
  const url = new URL(build1688AuthorizeUrl(baseConfig, 'state-1688'));
  assert.equal(url.origin, 'https://auth.example.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), '1000000');
  assert.equal(url.searchParams.get('site'), '1688');
  assert.equal(url.searchParams.get('redirect_uri'), baseConfig.redirectUri);
  assert.equal(url.searchParams.get('state'), 'state-1688');
});

test('exchange1688Code posts to the official getToken method without signing or leaking secret in result', async () => {
  let request;
  const result = await exchange1688Code(baseConfig, 'authorization-code', async (url, options) => {
    request = { url, options };
    return jsonResponse({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: '36000',
      refresh_token_timeout: '2027-01-01T00:00:00+0800',
      memberId: 'member-1',
    });
  });

  const body = new URLSearchParams(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/openapi/http/1/system.oauth2/getToken/1000000');
  assert.equal(request.options.method, 'POST');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('need_refresh_token'), 'true');
  assert.equal(body.get('client_id'), '1000000');
  assert.equal(body.get('client_secret'), 'test123');
  assert.equal(body.get('redirect_uri'), baseConfig.redirectUri);
  assert.equal(body.get('code'), 'authorization-code');
  assert.equal(body.has('_aop_signature'), false);
  assert.deepEqual(result, {
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    expiresIn: 36000,
    refreshTokenTimeout: '2027-01-01T00:00:00+0800',
    memberId: 'member-1',
  });
  assert.equal(JSON.stringify(result).includes('test123'), false);
});

test('refresh1688Token uses the refresh grant and keeps a non-rotated refresh token', async () => {
  let request;
  const result = await refresh1688Token(baseConfig, 'existing-refresh', async (url, options) => {
    request = { url, options };
    return jsonResponse({ access_token: 'renewed', expires_in: 36000 });
  });

  const body = new URLSearchParams(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/openapi/param2/1/system.oauth2/getToken/1000000');
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'existing-refresh');
  assert.equal(result.accessToken, 'renewed');
  assert.equal(result.refreshToken, 'existing-refresh');
});

test('call1688Api posts a signed param2 form request', async () => {
  let request;
  const result = await call1688Api(baseConfig, {
    namespace: 'com.alibaba.product',
    name: 'alibaba.category.get',
    params: { categoryID: 1031910 },
    requiresToken: false,
  }, async (url, options) => {
    request = { url, options };
    return jsonResponse({ succes: 'true', categoryInfo: [{ categoryID: 1031910 }] });
  });

  const body = new URLSearchParams(request.options.body);
  assert.equal(request.url, 'https://gateway.example.com/openapi/param2/1/com.alibaba.product/alibaba.category.get/1000000');
  assert.equal(request.options.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(body.get('categoryID'), '1031910');
  assert.equal(body.has('access_token'), false);
  assert.match(body.get('_aop_signature'), /^[A-F0-9]{40}$/);
  assert.deepEqual(result.categoryInfo, [{ categoryID: 1031910 }]);
});

test('call1688Api requires an access token for authenticated methods', async () => {
  await assert.rejects(
    call1688Api({ ...baseConfig, accessToken: '' }, {
      namespace: 'com.alibaba.product',
      name: 'alibaba.new.product.getSchema',
      params: { catId: 1, scene: 'cbu' },
    }, async () => jsonResponse({})),
    /Access Token/,
  );
});

test('call1688Api returns safe structured errors without secrets or tokens', async () => {
  await assert.rejects(
    call1688Api(baseConfig, {
      namespace: 'com.alibaba.product',
      name: 'alibaba.new.product.getSchema',
      params: { catId: 1, scene: 'cbu' },
    }, async () => jsonResponse({
      error_code: '401',
      error_message: 'access_token invalid',
      request_id: 'request-401',
      debug: `secret=${baseConfig.appSecret}&token=${baseConfig.accessToken}`,
    }, 401)),
    (error) => {
      assert.equal(error.code, '401');
      assert.equal(error.requestId, 'request-401');
      assert.match(error.message, /授权令牌无效或已过期/);
      assert.equal(JSON.stringify(error).includes(baseConfig.appSecret), false);
      assert.equal(JSON.stringify(error).includes(baseConfig.accessToken), false);
      return true;
    },
  );
});

test('read-only helpers use the exact official method names and parameters', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: Object.fromEntries(new URLSearchParams(options.body)) });
    if (url.includes('getSchema')) return jsonResponse({ result: { success: true, bizData: '{}' } });
    if (url.includes('getSubSchema')) return jsonResponse({ result: { success: true, bizData: '{}' } });
    return jsonResponse({ success: true, result: {} });
  };

  await search1688Categories(baseConfig, '反光背心', fetchImpl);
  await get1688Category(baseConfig, 1031910, fetchImpl);
  await get1688ProductSchema(baseConfig, { catId: 1031910, scene: 'popular' }, fetchImpl);
  await get1688ProductSubSchema(baseConfig, {
    catId: '1031910', scene: 'popular', dataBody: { formValues: { title: '示例' } },
  }, fetchImpl);
  await list1688Products(baseConfig, { pageNo: 1, pageSize: 20, cargoNumber: 'WB-001' }, fetchImpl);
  await get1688Product(baseConfig, '706291373455', fetchImpl);

  assert.deepEqual(requests.map(({ url }) => url.split('/').at(-2)), [
    'alibaba.category.searchByKeyword',
    'alibaba.category.get',
    'alibaba.new.product.getSchema',
    'alibaba.new.product.getSubSchema',
    'alibaba.product.list.get',
    'alibaba.product.get',
  ]);
  assert.equal(requests[0].body.keyword, '反光背心');
  assert.equal(requests[2].body.scene, 'popular');
  assert.equal(requests[3].body.dataBody, JSON.stringify({ formValues: { title: '示例' } }));
  assert.equal(requests[4].body.cargoNumber, 'WB-001');
  assert.equal(requests[5].body.productID, '706291373455');
});

test('upload1688Photo excludes image bytes from the signature input and returns official image metadata', async () => {
  let request;
  const result = await upload1688Photo(baseConfig, {
    albumId: '123',
    name: '主图.jpg',
    bytes: Buffer.from('image-data'),
  }, async (url, options) => {
    request = { url, options };
    return jsonResponse({ image: { id: 88, url: 'https://cbu01.alicdn.com/example.jpg' } });
  });

  const body = new URLSearchParams(request.options.body);
  assert.match(request.url, /alibaba\.photobank\.photo\.add/);
  assert.equal(body.get('albumID'), '123');
  assert.equal(body.get('name'), '主图.jpg');
  assert.equal(body.get('webSite'), '1688');
  assert.equal(body.get('imageBytes'), Buffer.from('image-data').toString('base64'));
  assert.deepEqual(result.image, { id: 88, url: 'https://cbu01.alicdn.com/example.jpg' });
});

test('publish1688Product sends one official write request and parses its nested business result', async () => {
  let calls = 0;
  const result = await publish1688Product(baseConfig, {
    catId: 1031910,
    scene: 'popular',
    dataBody: { global: {}, formValues: { title: '测试商品' } },
  }, async () => {
    calls += 1;
    return jsonResponse({
      result: {
        success: true,
        bizCode: '',
        bizMsg: '',
        bizData: { dataJson: JSON.stringify({ itemId: 706291373455, offerStatus: 'PUBLISHED' }) },
      },
      request_id: 'publish-request-1',
    });
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    success: true,
    bizCode: '',
    bizMsg: '',
    itemId: '706291373455',
    offerStatus: 'PUBLISHED',
    qualityScore: undefined,
    categoryId: undefined,
    requestId: 'publish-request-1',
    rawData: { itemId: 706291373455, offerStatus: 'PUBLISHED' },
  });
});

test('publish1688Product marks transport timeouts as uncertain and never retries', async () => {
  let calls = 0;
  await assert.rejects(
    publish1688Product(baseConfig, {
      catId: 1031910,
      scene: 'popular',
      dataBody: { global: {}, formValues: { title: '测试商品' } },
    }, async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }),
    (error) => {
      assert.equal(error.uncertain, true);
      assert.match(error.message, /结果不确定/);
      return true;
    },
  );
  assert.equal(calls, 1);
});
