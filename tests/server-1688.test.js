import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer } from '../src/server.js';

async function withServer(run, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'server-1688-'));
  const server = createServer({ rootDir, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl, rootDir);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function post(baseUrl, pathname, body) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('1688 OAuth routes are independent from ICBU token handlers', async () => {
  const calls = [];
  await withServer(async (baseUrl) => {
    const exchanged = await post(baseUrl, '/api/1688/token/exchange', {
      config: { appKey: '1688-key', appSecret: '1688-secret', redirectUri: 'https://callback.example' },
      code: '1688-code',
    });
    assert.deepEqual(await exchanged.json(), {
      accessToken: '1688-access', refreshToken: '1688-refresh', expiresIn: 36000,
    });
    const refreshed = await post(baseUrl, '/api/1688/token/refresh', {
      config: { appKey: '1688-key', appSecret: '1688-secret' }, refreshToken: '1688-refresh',
    });
    assert.deepEqual(await refreshed.json(), {
      accessToken: '1688-renewed', refreshToken: '1688-refresh', expiresIn: 36000,
    });
    assert.deepEqual(calls, [['exchange', '1688-key', '1688-code'], ['refresh', '1688-key', '1688-refresh']]);
  }, {
    exchange1688Code: async (config, code) => {
      calls.push(['exchange', config.appKey, code]);
      return { accessToken: '1688-access', refreshToken: '1688-refresh', expiresIn: 36000 };
    },
    refresh1688Token: async (config, token) => {
      calls.push(['refresh', config.appKey, token]);
      return { accessToken: '1688-renewed', refreshToken: token, expiresIn: 36000 };
    },
    exchangeAlibabaCode: async () => { throw new Error('不应调用 ICBU OAuth'); },
    refreshAlibabaToken: async () => { throw new Error('不应调用 ICBU refresh'); },
  });
});

test('1688 connection diagnostics return explicit capability blockers without credentials', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, '/api/1688/connection/test', { config: { appKey: 'key' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: false,
      stage: 'permission',
      message: '当前应用未订购新版商品管理解决方案（商家自用版）',
      missing: ['新版商品管理解决方案（商家自用版）'],
      writeReady: false,
    });
  }, {
    test1688Connection: async () => ({
      ok: false,
      stage: 'permission',
      message: '当前应用未订购新版商品管理解决方案（商家自用版）',
      missing: ['新版商品管理解决方案（商家自用版）'],
      writeReady: false,
    }),
  });
});

test('default 1688 capability becomes write-ready only after target Schema is read successfully', async () => {
  const calls = [];
  await withServer(async (baseUrl) => {
    const readonly = await post(baseUrl, '/api/1688/connection/test', { config: {} });
    assert.deepEqual(await readonly.json(), {
      ok: true,
      stage: 'readonly',
      message: '1688 签名、授权和只读类目接口验证成功',
      missing: ['尚未用目标叶子类目验证新版商品管理方案权限'],
      writeReady: false,
    });

    const capability = await post(baseUrl, '/api/1688/connection/test', {
      config: {}, categoryId: '1031910', scene: 'popular',
    });
    assert.deepEqual(await capability.json(), {
      ok: true,
      stage: 'schema',
      message: '1688 只读连接和目标类目新版商品规则验证成功',
      missing: [],
      writeReady: true,
    });
    assert.deepEqual(calls, ['search', 'search', 'schema:1031910:popular']);
  }, {
    search1688Categories: async () => { calls.push('search'); return { success: true }; },
    get1688ProductSchema: async (_config, params) => {
      calls.push(`schema:${params.catId}:${params.scene}`);
      return { result: { success: true, bizData: '{}' } };
    },
  });
});

test('1688 category and schema routes call only their dedicated read adapters', async () => {
  const calls = [];
  await withServer(async (baseUrl) => {
    const config = { appKey: '1688-key', appSecret: 'secret', accessToken: 'token' };
    assert.equal((await post(baseUrl, '/api/1688/categories/search', { config, keyword: '反光背心' })).status, 200);
    assert.equal((await post(baseUrl, '/api/1688/categories/get', { config, categoryId: '1031910' })).status, 200);
    assert.equal((await post(baseUrl, '/api/1688/schema/get', {
      config, catId: '1031910', scene: 'popular',
    })).status, 200);
    assert.equal((await post(baseUrl, '/api/1688/schema/sub', {
      config, catId: '1031910', scene: 'popular', dataBody: { formValues: { title: '商品' } },
    })).status, 200);
    assert.deepEqual(calls.map(([name]) => name), ['search', 'category', 'schema', 'sub']);
  }, {
    search1688Categories: async (config, keyword) => {
      calls.push(['search', config.appKey, keyword]);
      return { success: true, products: [] };
    },
    get1688Category: async (config, categoryId) => {
      calls.push(['category', config.appKey, categoryId]);
      return { succes: 'true', categoryInfo: [] };
    },
    get1688ProductSchema: async (config, params) => {
      calls.push(['schema', config.appKey, params]);
      return { result: { success: true, bizData: '{}' } };
    },
    get1688ProductSubSchema: async (config, params) => {
      calls.push(['sub', config.appKey, params]);
      return { result: { success: true, bizData: '{}' } };
    },
  });
});

test('1688 preflight returns missing fields and a safe request summary', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, '/api/1688/preflight', {
      schema: {
        global: { systemParam: { catId: 1031910 } },
        fields: {
          title: { name: 'title', type: 'input', label: '商品标题', required: true },
          image: { name: 'primaryPicture', type: 'image', label: '商品主图', required: true },
        },
      },
      catId: 1031910,
      scene: 'popular',
      formValues: { title: '反光背心', accessToken: 'must-not-return' },
    });
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(body.preflight.valid, false);
    assert.equal(body.preflight.errors[0].path, 'primaryPicture');
    assert.equal(body.summary.method, 'alibaba.new.product.add');
    assert.equal(text.includes('must-not-return'), false);
  });
});

test('1688 task routes persist and restore independent safe tasks', async () => {
  await withServer(async (baseUrl) => {
    const createdResponse = await post(baseUrl, '/api/1688/tasks', {
      id: 'task-1',
      task: { product: { title: '商品' }, accessToken: 'do-not-store' },
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.task.id, 'task-1');

    const readResponse = await fetch(`${baseUrl}/api/1688/tasks/task-1`);
    const readText = await readResponse.text();
    assert.equal(readResponse.status, 200);
    assert.equal(readText.includes('do-not-store'), false);
    assert.equal(JSON.parse(readText).task.product.title, '商品');

    const updateResponse = await fetch(`${baseUrl}/api/1688/tasks/task-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: created.task.version, task: { ...created.task, product: { title: '新标题' } } }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).task.version, 2);

    const listResponse = await fetch(`${baseUrl}/api/1688/tasks`);
    assert.equal((await listResponse.json()).tasks.length, 1);
  });
});

test('1688 image upload validates format and the official 2 MB limit before calling the adapter', async () => {
  let uploads = 0;
  await withServer(async (baseUrl) => {
    const invalid = await post(baseUrl, '/api/1688/images/upload', {
      confirmUpload: true,
      config: {},
      image: { fileName: 'bad.webp', dataUrl: 'data:image/webp;base64,YQ==' },
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /jpg、jpeg、gif、bmp、png/);

    const tooLarge = await post(baseUrl, '/api/1688/images/upload', {
      confirmUpload: true,
      config: {},
      image: {
        fileName: 'large.jpg',
        dataUrl: `data:image/jpeg;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`,
      },
    });
    assert.equal(tooLarge.status, 413);

    const uploaded = await post(baseUrl, '/api/1688/images/upload', {
      confirmUpload: true,
      config: { appKey: 'key' },
      image: { fileName: '主图.jpg', dataUrl: 'data:image/jpeg;base64,aW1hZ2U=', albumId: '123' },
    });
    assert.equal(uploaded.status, 200);
    assert.deepEqual(await uploaded.json(), {
      image: { id: 'photo-1', url: 'https://img.example/1.jpg' },
    });
    assert.equal(uploads, 1);
  }, {
    upload1688Photo: async (config, image) => {
      uploads += 1;
      assert.equal(config.appKey, 'key');
      assert.equal(image.albumId, '123');
      assert.equal(image.bytes.toString(), 'image');
      return { image: { id: 'photo-1', url: 'https://img.example/1.jpg' } };
    },
  });
});

test('1688 image upload preserves official upload error codes', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, '/api/1688/images/upload', {
      confirmUpload: true,
      config: {},
      image: { fileName: '主图.png', dataUrl: 'data:image/png;base64,aW1hZ2U=', albumId: '123' },
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: '调用频繁', code: '36' });
  }, {
    upload1688Photo: async () => {
      throw Object.assign(new Error('调用频繁'), { code: '36', status: 429 });
    },
  });
});

async function createReadyTask(baseUrl, overrides = {}) {
  const task = {
    categoryId: '1031910',
    scene: 'popular',
    schema: {
      global: { systemParam: { catId: 1031910 } },
      fields: {
        title: { name: 'title', type: 'input', label: '商品标题', required: true },
        primaryPicture: { name: 'primaryPicture', type: 'image', label: '商品主图', required: true },
      },
    },
    product: {
      key: 'product-1',
      title: '反光背心',
      cargoNumber: 'WB-001',
      formValues: {
        title: '反光背心',
        cargoNumber: 'WB-001',
        primaryPicture: { imageList: [{ id: 'photo-1', url: 'https://img.example/1.jpg' }] },
        skuTable: [{ sku_cargoNumber: 'WB-001', sku_price: 12.5, sku_amountOnSale: 20 }],
      },
    },
    publication: { status: 'draft', writeConsumed: false },
    ...overrides,
  };
  const preflight = await post(baseUrl, '/api/1688/preflight', {
    schema: task.schema,
    catId: task.categoryId,
    scene: task.scene,
    formValues: task.product.formValues,
  }).then((response) => response.json());
  task.schemaHash = preflight.schemaHash;
  task.publication = {
    status: 'ready',
    writeConsumed: false,
    fingerprint: preflight.fingerprint,
    schemaHash: preflight.schemaHash,
  };
  const response = await post(baseUrl, '/api/1688/tasks', { id: 'publish-task', task });
  return { task: (await response.json()).task, preflight };
}

test('1688 publish route is disabled by default even when a task is ready', async () => {
  let writes = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /真实发布默认关闭/);
    assert.equal(writes, 0);
  }, {
    publish1688Product: async () => { writes += 1; },
  });
});

test('1688 publish route requires capability and SDK readiness before consuming the write', async () => {
  let writes = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: false, confirmation: true,
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /JS SDK/);
    assert.equal(writes, 0);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => { writes += 1; },
  });
});

test('1688 publish performs one write, persists it first, then verifies with readonly product.get', async () => {
  let writes = 0;
  let readonlyGets = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const body = {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
    };
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', body);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.publication.status, 'published_verified', JSON.stringify(result.publication));
    assert.equal(result.publication.productId, '706291373455');
    assert.equal(writes, 1);
    assert.equal(readonlyGets, 1);

    const duplicate = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', body);
    assert.equal(duplicate.status, 409);
    assert.equal(writes, 1);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => {
      writes += 1;
      return { itemId: '706291373455', requestId: 'request-1', offerStatus: 'PUBLISHED' };
    },
    get1688Product: async () => {
      readonlyGets += 1;
      return { productInfo: {
        productID: '706291373455', cargoNumber: 'WB-001', categoryID: '1031910',
        subject: '反光背心', status: 'published',
      } };
    },
  });
});

test('1688 publish response without an id performs cargo-number reconciliation and never resubmits', async () => {
  let writes = 0;
  let readonlyLists = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const body = {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
    };
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', body);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.publication.status, 'published_verified', JSON.stringify(result.publication));
    assert.equal(result.publication.productId, '706291373455');
    assert.equal(writes, 1);
    assert.equal(readonlyLists, 1);

    const duplicate = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', body);
    assert.equal(duplicate.status, 409);
    assert.equal(writes, 1);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => {
      writes += 1;
      return { requestId: 'request-without-id', offerStatus: 'PUBLISHED' };
    },
    list1688Products: async (_config, params) => {
      readonlyLists += 1;
      assert.equal(params.cargoNumber, 'WB-001');
      return { result: { products: [{
        productID: '706291373455', cargoNumber: 'WB-001', categoryID: '1031910',
        subject: '反光背心', status: 'published',
      }] } };
    },
  });
});

test('1688 publish blocks stale versions, changed schemas and changed fingerprints before writing', async () => {
  let writes = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    for (const override of [
      { version: task.version - 1 },
      { schemaHash: 'changed-schema' },
      { fingerprint: 'changed-fingerprint' },
    ]) {
      const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', {
        config: {}, version: task.version, fingerprint: preflight.fingerprint,
        schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
        ...override,
      });
      assert.equal(response.status, 409);
    }
    assert.equal(writes, 0);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => { writes += 1; },
  });
});

test('1688 publish timeout becomes uncertain and manual reconciliation performs no second write', async () => {
  let writes = 0;
  let readonlyLists = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
    });
    const result = await response.json();
    assert.equal(response.status, 202);
    assert.equal(result.publication.status, 'uncertain');
    assert.equal(writes, 1);

    const reconciled = await post(baseUrl, '/api/1688/publications/publish-task/reconcile', { config: {} });
    assert.equal(reconciled.status, 200);
    assert.equal((await reconciled.json()).publication.status, 'published_verified');
    assert.equal(writes, 1);
    assert.equal(readonlyLists, 1);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => {
      writes += 1;
      throw Object.assign(new Error('结果不确定'), { uncertain: true, code: 'NETWORK_TIMEOUT' });
    },
    list1688Products: async () => {
      readonlyLists += 1;
      return { result: { productInfos: [{
        productID: '706291373455', cargoNumber: 'WB-001', categoryID: '1031910',
        subject: '反光背心', status: 'published',
      }] } };
    },
  });
});

test('1688 explicit business failures remain retry-blocking and preserve their code', async () => {
  let writes = 0;
  await withServer(async (baseUrl) => {
    const { task, preflight } = await createReadyTask(baseUrl);
    const response = await post(baseUrl, '/api/1688/tasks/publish-task/products/product-1/publish', {
      config: {}, version: task.version, fingerprint: preflight.fingerprint,
      schemaHash: preflight.schemaHash, sdkReady: true, confirmation: true,
    });
    const result = await response.json();
    assert.equal(response.status, 422);
    assert.equal(result.publication.status, 'publish_failed');
    assert.equal(result.publication.errorCode, 'CHK_TITLE');
    assert.equal(writes, 1);
  }, {
    allow1688Writes: true,
    test1688Connection: async () => ({ ok: true, writeReady: true, missing: [] }),
    publish1688Product: async () => {
      writes += 1;
      throw Object.assign(new Error('标题包含违禁词'), { code: 'CHK_TITLE' });
    },
  });
});
