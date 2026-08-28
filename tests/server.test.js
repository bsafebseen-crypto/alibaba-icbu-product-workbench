import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/server.js';

const sellingPointBinding = {
  fieldId: 'sellingPoints', carrierPath: ['value'], structureType: 'single-text',
  categoryId: '32905', language: 'en_US', version: 'trade.1.1',
};

async function withServer(run, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-server-'));
  const server = createServer({ rootDir, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl, rootDir);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
  }
}

test('POST /api/ai/test forwards settings to the AI connection checker', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'm' }),
    });
    assert.deepEqual(await response.json(), { ok: true, message: 'stubbed' });
    assert.equal(received.model, 'm');
  }, {
    testAiConnection: async (config) => {
      received = config;
      return { ok: true, message: 'stubbed' };
    },
  });
});

test('POST /api/alibaba/test forwards credentials without returning secrets', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/alibaba/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: '511556', appSecret: 'secret', accessToken: 'token' }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes('secret'), false);
    assert.equal(text.includes('token'), false);
    assert.deepEqual(JSON.parse(text), { ok: true, message: 'stubbed' });
    assert.equal(received.appKey, '511556');
  }, {
    testAlibabaConnection: async (config) => {
      received = config;
      return { ok: true, message: 'stubbed' };
    },
  });
});

test('POST /api/alibaba/token exchanges an authorization code', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/alibaba/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { appKey: '511556', appSecret: 'secret' }, code: 'auth-code' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    });
    assert.equal(received.code, 'auth-code');
    assert.equal(received.config.appSecret, 'secret');
  }, {
    exchangeAlibabaCode: async (config, code) => {
      received = { config, code };
      return { accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600 };
    },
  });
});

test('POST /api/alibaba/token/refresh refreshes an existing token', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/alibaba/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { appKey: '511556', appSecret: 'secret' }, refreshToken: 'old' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accessToken: 'renewed', refreshToken: 'rotated' });
  }, {
    refreshAlibabaToken: async (config, refreshToken) => {
      assert.equal(config.appKey, '511556');
      assert.equal(refreshToken, 'old');
      return { accessToken: 'renewed', refreshToken: 'rotated' };
    },
  });
});

test('POST /api/alibaba/product-template loads a source product read-only', async () => {
  let received;
  const schemaXml = '<itemSchema><field id="subject"><input value="Original" /></field><field id="product_summary"><textarea value="Summary" /></field><field id="product_faq"><input id="question" value="Question?" /><input id="answer" value="Answer." /></field></itemSchema>';
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/alibaba/product-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: '511556', appSecret: 'secret', accessToken: 'token' },
        productId: '1601915922577',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sourceProductId: '1601915922577',
      schemaXml,
      traceId: 'trace-1',
      analysis: {
        fieldCount: 3,
        recognized: {
          title: { fieldId: 'subject', value: 'Original' },
          productSummary: { fieldId: 'product_summary', value: 'Summary' },
          faq: { fieldId: 'product_faq', items: [{ question: 'Question?', answer: 'Answer.' }] },
          customAttributes: null,
          images: null,
        },
        warnings: ['未识别自定义属性字段'],
      },
    });
    assert.equal(received.productId, '1601915922577');
    assert.equal(received.config.appSecret, 'secret');
  }, {
    loadAlibabaProductTemplate: async (config, productId) => {
      received = { config, productId };
      return { sourceProductId: productId, schemaXml, traceId: 'trace-1' };
    },
  });
});

test('POST /api/alibaba/photobank/upload decodes one local image and returns only upload metadata', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/alibaba/photobank/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: '511556', appSecret: 'secret', accessToken: 'token' },
        image: {
          fileName: 'main.jpg',
          dataUrl: 'data:image/jpeg;base64,AQID',
        },
        groupId: '17590',
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      fileName: 'generated.jpg',
      fileId: '73826382',
      photobankUrl: 'https://img.alicdn.com/generated.jpg',
      requestId: 'request-photo',
    });
    assert.equal(received.config.appSecret, 'secret');
    assert.equal(received.image.fileName, 'main.jpg');
    assert.equal(received.image.mimeType, 'image/jpeg');
    assert.deepEqual([...received.image.imageBytes], [1, 2, 3]);
    assert.equal(received.image.groupId, '17590');
  }, {
    uploadAlibabaPhoto: async (config, image) => {
      received = { config, image };
      return {
        fileName: 'generated.jpg',
        fileId: '73826382',
        photobankUrl: 'https://img.alicdn.com/generated.jpg',
        requestId: 'request-photo',
      };
    },
  });
});

test('POST /api/products/preview creates four independent local previews', async () => {
  const schemaXml = '<itemSchema><field id="subject"><input value="Original" /></field><field id="product_summary"><textarea value="Summary" /></field><field id="product_faq"><input id="question" value="Question?" /><input id="answer" value="Answer." /></field><field id="custom_attributes"><complex-values><complex-value><input id="attribute_name_1" value="Material" /><input id="attribute_value_1" value="Polyester" /></complex-value></complex-values></field><field id="sku"><input value="SKU-001" /></field></itemSchema>';
  const products = Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    sourceProductId: '1601915922577',
    title: `Variant ${index + 1}`,
    sellingPoints: `Summary ${index + 1}`,
    faq: 'Q: Can I customize it?\nA: Yes.',
  }));

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaXml, products }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.previews.length, 4);
    assert.deepEqual(body.previews.map((preview) => preview.status), Array(4).fill('preview'));
    assert.match(body.previews[0].previewXml, /Variant 1/);
    assert.doesNotMatch(body.previews[0].previewXml, /Variant 2/);
    assert.match(body.previews[3].previewXml, /Variant 4/);
    assert.equal(body.previews.every((preview) => preview.changedFields.length === 3), true);
    assert.equal(body.previews.every((preview) => preview.previewXml.includes('SKU-001')), true);
  });
});

test('POST /api/products/preview requires exactly four products', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaXml: '<itemSchema />', products: [] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /必须正好包含 4 个类似品/);
  });
});

test('POST /api/products/generate returns products from the AI generator', async () => {
  const expected = Array.from({ length: 5 }, (_, index) => ({
    index: index + 1,
    kind: index === 0 ? 'base' : 'similar',
    title: `Title ${index + 1}`,
    sellingPoints: '',
    keywords: [],
  }));
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { model: 'm' }, source: { words: ['vest'] } }),
    });
    assert.deepEqual(await response.json(), { products: expected });
  }, {
    generateProducts: async (config, source) => {
      assert.equal(config.model, 'm');
      assert.deepEqual(source.words, ['vest']);
      return expected;
    },
  });
});

test('POST /api/products/generate-similar returns four generated products without credentials or images', async () => {
  const expected = Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    kind: 'similar',
    title: `Title ${index + 1}`,
    sellingPoints: `Summary ${index + 1}`,
    faqItems: Array.from({ length: 5 }, () => ({ question: 'Question?', answer: 'Answer.' })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    attributeChanges: [],
    keywords: ['safety vest'],
    imageAssignment: { mainImageIndex: index, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
  }));
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/generate-similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { apiKey: 'secret-key', model: 'vision-model' },
        source: { imageDataUrls: [{ dataUrl: 'data:image/jpeg;base64,AAA' }] },
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /secret-key|data:image/);
    assert.deepEqual(JSON.parse(text), { products: expected, visionUsed: true });
  }, {
    generateSimilarProducts: async (config, source) => {
      assert.equal(config.model, 'vision-model');
      assert.equal(source.imageDataUrls.length, 1);
      return { products: expected, visionUsed: true, apiKey: 'secret-key' };
    },
  });
});

test('POST /api/keywords/xlsx returns parsed workbook keywords', async () => {
  let receivedSize = 0;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/keywords/xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: Buffer.from('fake-workbook'),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { words: ['Safety Vest'], sheets: ['Sheet1'] });
    assert.equal(receivedSize, 13);
  }, {
    parseKeywordWorkbook: async (buffer) => {
      receivedSize = buffer.length;
      return { words: ['Safety Vest'], sheets: ['Sheet1'] };
    },
  });
});

test('GET /api/health reports a local healthy service', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test('POST /api/products/manual returns exactly five editable products', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.products.length, 5);
    assert.equal(body.products[0].kind, 'base');
  });
});

test('POST endpoints reject invalid JSON with a Chinese 400 error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/);
  });
});

test('POST /api/tasks saves a task without returning its API key', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'do-not-return',
        generation: { apiKey: 'nested-secret', provider: 'custom' },
        products: Array.from({ length: 5 }, (_, index) => ({ index: index + 1 })),
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 201);
    assert.equal(text.includes('do-not-return'), false);
    assert.equal(text.includes('nested-secret'), false);
    assert.match(text, /"status":"prepared"/);
  });
});

test('GET /api/tasks and /api/tasks/:id expose safe read-only task data', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'must-not-leak',
        source: { sourceProductId: '1601915922577' },
        products: [{ index: 1, title: 'Safety Vest' }],
      }),
    }).then((response) => response.json());

    const listResponse = await fetch(`${baseUrl}/api/tasks`);
    const listText = await listResponse.text();
    assert.equal(listResponse.status, 200);
    assert.doesNotMatch(listText, /must-not-leak/);
    assert.equal(JSON.parse(listText).tasks[0].id, created.id);

    const detailResponse = await fetch(`${baseUrl}/api/tasks/${created.id}`);
    const detailText = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.doesNotMatch(detailText, /must-not-leak|data:image/);
    assert.equal(JSON.parse(detailText).products[0].title, 'Safety Vest');

    const missingResponse = await fetch(`${baseUrl}/api/tasks/missing-task`);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: '任务不存在' });
  });
});

test('unknown API routes return JSON 404', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: '接口不存在' });
  });
});

test('GET / serves the workbench page and client script', async () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer({ rootDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /国际站自动上品/);
    assert.match(html, /data-module="auto-listing"/);
    assert.match(html, /data-module="dashboard"/);
    assert.match(html, /data-module="product-pool"/);
    assert.match(html, /data-module="keywords"/);
    assert.match(html, /data-module="ai-settings"/);
    assert.match(html, /data-module="alibaba-settings"/);
    assert.match(html, /id="ali-authorize"/);
    assert.match(html, /id="ali-auth-code"/);
    assert.match(html, /id="ali-exchange"/);
    assert.match(html, /id="source-product-id"/);
    assert.match(html, /id="load-source-product"/);
    assert.match(html, /id="faq-rows"/);
    assert.match(html, /id="schema-recognition"/);
    assert.match(html, /id="recognition-images"/);
    assert.match(html, /id="generate-previews"/);
    assert.match(html, /id="generate-image-previews"/);
    assert.match(html, /生成含图片的完整预览/);
    assert.match(html, /id="preview-summary"/);
    assert.match(html, /id="similar-main-images"/);
    assert.match(html, /id="auxiliary-image-pool"/);
    assert.match(html, /id="assigned-images"/);
    assert.match(html, /id="custom-attribute-rows"/);
    assert.match(html, /id="ai-generate-similar"/);
    assert.match(html, /id="upload-photobank"/);
    assert.match(html, /id="photobank-status"/);
    assert.match(html, /id="ali-photobank-group"/);
    assert.match(html, /id="operations-topbar"/);
    assert.match(html, /id="top-local-state"/);
    assert.match(html, /id="module-dashboard"/);
    assert.match(html, /id="module-product-pool"/);
    assert.match(html, /id="pool-search"/);
    assert.match(html, /id="pool-stage"/);
    assert.match(html, /id="pool-table-body"/);
    assert.match(html, /id="pool-empty"/);
    assert.match(html, /id="pool-refresh"/);
    assert.match(html, /id="pool-export"/);
    assert.match(html, /id="product-drawer"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /id="drawer-close"/);
    assert.match(html, /id="drawer-tabs"/);
    assert.match(html, /id="drawer-content"/);
    assert.match(html, /id="current-batch-panel"/);
    assert.match(html, /id="metric-batches"/);
    assert.match(html, /id="metric-products"/);
    assert.match(html, /id="metric-ready"/);
    assert.match(html, /id="metric-attention"/);
    assert.match(html, /id="recent-batches"/);
    assert.match(html, /id="stage-materials"/);
    assert.match(html, /id="stage-keywords"/);
    assert.match(html, /id="stage-ai"/);
    assert.match(html, /id="stage-photobank"/);
    assert.match(html, /id="stage-preview"/);
    assert.match(html, /id="stage-save"/);
    assert.match(html, /accept="\.csv,\.txt,\.xlsx/);
    assert.equal((html.match(/class="image-slot/g) || []).length, 4);
    assert.match(html, /src="\/app\.js"/);
    assert.doesNotMatch(html, /六张主图/);

    const productPoolModule = await fetch(`http://127.0.0.1:${port}/product-pool.js`);
    assert.equal(productPoolModule.status, 200);
    assert.match(await productPoolModule.text(), /buildProductRows/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/obsidian/batches returns sanitized read-only batch metadata', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/batches`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      rootAvailable: true,
      batches: [{ relativePath: 'vests/batch.md', valid: true, batchId: 'batch-1' }],
    });
  }, {
    obsidianRoot: 'C:\\vault\\listings',
    listObsidianBatches: async (root) => {
      assert.equal(root, 'C:\\vault\\listings');
      return [{ relativePath: 'vests/batch.md', valid: true, batchId: 'batch-1' }];
    },
  });
});

test('POST /api/obsidian/batch loads one validated relative path', async () => {
  let receivedPath;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath: 'vests/batch.md' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { batchId: 'batch-1', plans: [1, 2, 3, 4, 5] });
    assert.equal(receivedPath, 'vests/batch.md');
  }, {
    obsidianRoot: 'C:\\vault\\listings',
    readObsidianBatch: async (root, relativePath) => {
      assert.equal(root, 'C:\\vault\\listings');
      receivedPath = relativePath;
      return { batchId: 'batch-1', plans: [1, 2, 3, 4, 5] };
    },
  });
});

test('POST /api/obsidian/batch returns 400 for an unsafe path', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath: '../outside.md' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: '文件必须位于 Obsidian 发品目录内' });
  }, {
    readObsidianBatch: async () => {
      throw new Error('文件必须位于 Obsidian 发品目录内');
    },
  });
});

test('GET / exposes the Obsidian publishing module and its browser controller', async () => {
  const server = createServer({ rootDir: process.cwd() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await (await fetch(`${baseUrl}/`)).text();
    assert.match(page, /data-module="obsidian-publishing"/);
    assert.match(page, /id="module-obsidian-publishing"/);
    assert.match(page, /id="obsidian-file-select"/);
    assert.match(page, /id="obsidian-plan-list"/);
    assert.match(page, /id="obsidian-load-source"/);
    assert.match(page, /id="obsidian-variant-list"/);
    assert.match(page, /id="obsidian-upload-images"/);
    assert.match(page, /id="obsidian-generate-previews"/);
    assert.match(page, /id="obsidian-draft-status"/);
    assert.match(page, /id="obsidian-saved-drafts"/);

    const controller = await fetch(`${baseUrl}/obsidian-publishing.js`);
    assert.equal(controller.status, 200);
    assert.match(await controller.text(), /initObsidianPublishing/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/obsidian/source-product loads read-only context and schema analysis', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/source-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { appKey: 'key' }, productId: '1601915922577' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sourceProductId: '1601915922577',
      categoryId: '32905',
      schemaXml: '<itemSchema />',
      analysis: { warnings: [] },
    });
    assert.deepEqual(received, { config: { appKey: 'key' }, input: { productId: '1601915922577' } });
  }, {
    loadAlibabaProductContext: async (config, input) => {
      received = { config, input };
      return { sourceProductId: input.productId, categoryId: '32905', schemaXml: '<itemSchema />' };
    },
    analyzeProductSchema: () => ({ warnings: [] }),
  });
});

test('photobank cache routes recover a successful digest-backed upload', async () => {
  const sha256 = 'a'.repeat(64);
  await withServer(async (baseUrl) => {
    const upload = await fetch(`${baseUrl}/api/alibaba/photobank/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: 'key', appSecret: 'secret', accessToken: 'token' },
        image: { fileName: 'main.jpg', dataUrl: 'data:image/jpeg;base64,AQID', sha256 },
      }),
    });
    assert.equal(upload.status, 200);
    const resolved = await fetch(`${baseUrl}/api/alibaba/photobank/cache/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [{ sha256 }] }),
    });
    assert.equal(resolved.status, 200);
    assert.deepEqual(await resolved.json(), {
      uploads: {
        [sha256]: {
          fileName: 'main.jpg', fileId: 'file-1',
          photobankUrl: 'https://img.example.com/main.jpg',
        },
      },
    });
  }, {
    uploadAlibabaPhoto: async () => ({
      fileName: 'main.jpg', fileId: 'file-1',
      photobankUrl: 'https://img.example.com/main.jpg', requestId: 'request-1',
    }),
  });
});

test('fixed image routes require confirmation and return revalidated safe metadata', async () => {
  await withServer(async (baseUrl, rootDir) => {
    const first = path.join(rootDir, '2.jpg');
    const second = path.join(rootDir, '证书主图.jpg');
    await writeFile(first, Buffer.from([1, 2, 3]));
    await writeFile(second, Buffer.from([4, 5, 6]));
    const blocked = await fetch(`${baseUrl}/api/obsidian/fixed-images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [{ name: '通用图', filePath: first }, { name: '证书图', filePath: second }] }),
    });
    assert.equal(blocked.status, 400);
    const saved = await fetch(`${baseUrl}/api/obsidian/fixed-images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmed: true,
        slots: [{ name: '通用图', filePath: first }, { name: '证书图', filePath: second }],
      }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).slots.every((slot) => slot.ready), true);
    const reread = await fetch(`${baseUrl}/api/obsidian/fixed-images`);
    const text = await reread.text();
    assert.equal(reread.status, 200);
    assert.doesNotMatch(text, /base64|imageBytes|accessToken/);
    assert.equal(JSON.parse(text).slots.length, 2);
  });
});

test('POST /api/obsidian/fixed-images/upload uploads one configured file and caches its digest', async () => {
  let uploaded;
  await withServer(async (baseUrl, rootDir) => {
    const first = path.join(rootDir, '2.jpg');
    const second = path.join(rootDir, '证书主图.jpg');
    await writeFile(first, Buffer.from([1, 2, 3]));
    await writeFile(second, Buffer.from([4, 5, 6]));
    const configured = await (await fetch(`${baseUrl}/api/obsidian/fixed-images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmed: true,
        slots: [{ name: '通用图', filePath: first }, { name: '证书图', filePath: second }],
      }),
    })).json();
    const target = configured.slots[0];
    const response = await fetch(`${baseUrl}/api/obsidian/fixed-images/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: 'key', appSecret: 'secret', accessToken: 'token' },
        sha256: target.sha256,
        confirmed: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(uploaded.fileName, '2.jpg');
    assert.deepEqual([...uploaded.imageBytes], [1, 2, 3]);
    const resolved = await (await fetch(`${baseUrl}/api/alibaba/photobank/cache/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [{ sha256: target.sha256 }] }),
    })).json();
    assert.equal(resolved.uploads[target.sha256].fileId, 'fixed-file');
  }, {
    uploadAlibabaPhoto: async (_config, image) => {
      uploaded = image;
      return {
        fileName: image.fileName, fileId: 'fixed-file',
        photobankUrl: 'https://img.example.com/fixed.jpg', requestId: 'fixed-request',
      };
    },
  });
});

test('POST /api/obsidian/selling-points/diagnose returns only safe field structure summaries', async () => {
  const sourceSchema = '<itemSchema><field id="textDesc" name="商品卖点"><value>Source summary</value></field><field id="detail"><value>private product detail</value></field></itemSchema>';
  const draftSchema = '<itemSchema><field id="textDesc" name="商品卖点"><value>Draft summary</value></field></itemSchema>';
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/selling-points/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: 'key', appSecret: 'must-not-return', accessToken: 'token' },
        sourceProductId: '1601933369105',
        draftProductId: '1601933441594',
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /itemSchema|private product detail|must-not-return|Source summary|Draft summary/);
    assert.deepEqual(JSON.parse(text), {
      context: { categoryId: '301504', language: 'en', version: 'trade.1.1' },
      sourceCandidates: [{
        fieldId: 'textDesc', fieldName: '商品卖点', structureType: 'single-text',
        carrierPaths: [['value']], nonEmpty: true,
      }],
      draftCandidates: [{
        fieldId: 'textDesc', fieldName: '商品卖点', structureType: 'single-text',
        carrierPaths: [['value']], nonEmpty: true,
      }],
    });
  }, {
    loadAlibabaProductContext: async (_config, { productId }) => ({
      sourceProductId: productId,
      categoryId: '301504', language: 'en', version: 'trade.1.1', schemaXml: sourceSchema,
    }),
    loadAlibabaProductDraft: async (_config, request) => {
      assert.deepEqual(request, {
        productId: '1601933441594', categoryId: '301504', language: 'en',
      });
      return { schemaXml: draftSchema };
    },
  });
});

test('POST /api/obsidian/selling-points/binding requires confirmation and stores safe binding metadata', async () => {
  const schemaXml = '<itemSchema><field id="textDesc" name="商品卖点"><value>Source summary</value></field></itemSchema>';
  await withServer(async (baseUrl, rootDir) => {
    const requestBody = {
      config: { appKey: 'key', appSecret: 'must-not-persist', accessToken: 'token' },
      sourceProductId: '1601933369105',
      binding: { fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text' },
    };
    const blocked = await fetch(`${baseUrl}/api/obsidian/selling-points/binding`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    assert.equal(blocked.status, 400);

    const response = await fetch(`${baseUrl}/api/obsidian/selling-points/binding`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, confirmed: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      binding: {
        fieldId: 'textDesc', carrierPath: ['value'], structureType: 'single-text',
        categoryId: '301504', language: 'en', version: 'trade.1.1',
      },
    });
    const raw = await readFile(path.join(rootDir, 'data', 'alibaba-schema-bindings.json'), 'utf8');
    assert.doesNotMatch(raw, /must-not-persist|accessToken|itemSchema|Source summary/);
  }, {
    loadAlibabaProductContext: async () => ({
      categoryId: '301504', language: 'en', version: 'trade.1.1', schemaXml,
    }),
  });
});

test('POST /api/obsidian/preview builds four fingerprinted previews from the stored batch', async () => {
  await withServer(async (baseUrl) => {
    const imagesByPlan = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
      `variant-${index + 1}`,
      Array.from({ length: 6 }, (__, imageIndex) => ({ fileId: `${index}-${imageIndex}`, url: `https://img/${index}-${imageIndex}` })),
    ]));
    const response = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'batch.md',
        basePlanId: 'base',
        planIds: ['variant-1', 'variant-2', 'variant-3', 'variant-4'],
        sourceContext: {
          sourceProductId: '1601933369105', categoryId: '32905', language: 'en_US',
          version: 'trade.1.1', schemaXml: '<itemSchema />',
        },
        sellingPointBinding,
        imagesByPlan,
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.previews.map(({ planId, fingerprint }) => ({ planId, fingerprint })), [
      { planId: 'variant-1', fingerprint: 'hash-variant-1' },
      { planId: 'variant-2', fingerprint: 'hash-variant-2' },
      { planId: 'variant-3', fingerprint: 'hash-variant-3' },
      { planId: 'variant-4', fingerprint: 'hash-variant-4' },
    ]);
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch', plans: [] }),
    createObsidianVariants: () => Array.from({ length: 4 }, (_, index) => ({ planId: `variant-${index + 1}` })),
    readSellingPointBinding: async () => sellingPointBinding,
    validateSellingPointBinding: () => sellingPointBinding,
    createStrictProductPreview: (schemaXml, variant) => {
      assert.equal(schemaXml, '<itemSchema />');
      assert.equal(variant.alibabaImages.length, 6);
      return { fingerprint: `hash-${variant.planId}`, changedFields: ['title'] };
    },
  });
});

test('POST /api/obsidian/preview rejects missing image assignments before schema generation', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'batch.md', basePlanId: 'base', planIds: ['variant-1'],
        sourceContext: {
          sourceProductId: '1601933369105', categoryId: '32905', language: 'en_US',
          version: 'trade.1.1', schemaXml: '<itemSchema />',
        },
        sellingPointBinding,
        imagesByPlan: {},
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /variant-1.*6 张图片/);
  }, {
    readObsidianBatch: async () => ({ plans: [] }),
    createObsidianVariants: () => Array.from({ length: 4 }, (_, index) => ({ planId: `variant-${index + 1}` })),
    readSellingPointBinding: async () => sellingPointBinding,
    validateSellingPointBinding: () => sellingPointBinding,
  });
});

test('POST /api/obsidian/preview requires persisted selling-point binding and rejects completed plans', async () => {
  const requestBody = {
    relativePath: 'batch.md',
    basePlanId: 'base',
    planIds: ['variant-1'],
    sourceContext: {
      sourceProductId: '1601933369105', categoryId: '32905', language: 'en_US',
      version: 'trade.1.1', schemaXml: '<itemSchema />',
    },
    imagesByPlan: {
      'variant-1': Array.from({ length: 6 }, () => ({ fileId: 'id', url: 'https://img' })),
    },
  };
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /卖点字段.*校准/);
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch', plans: [] }),
    createObsidianVariants: () => [{ planId: 'variant-1' }, { planId: 'variant-2' }],
    readSellingPointBinding: async () => null,
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /variant-1.*已有草稿/);
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch', plans: [] }),
    createObsidianVariants: () => [{ planId: 'variant-1' }, { planId: 'variant-2' }],
    readSellingPointBinding: async () => ({
      fieldId: 'sellingPoints', carrierPath: ['value'], structureType: 'single-text',
      categoryId: '32905', language: 'en_US', version: 'trade.1.1',
    }),
    validateSellingPointBinding: (_schemaXml, binding) => binding,
    listCompletedObsidianPlanIds: async () => ['variant-1'],
  });
});

test('POST /api/obsidian/preview permits an explicitly confirmed replacement bound to the prior draft id', async () => {
  let storedTaskInput;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'batch.md',
        basePlanId: 'base',
        planIds: ['variant-1'],
        sourceContext: {
          sourceProductId: '1601933369105', categoryId: '32905', language: 'en_US',
          version: 'trade.1.1', schemaXml: '<itemSchema />',
        },
        sellingPointBinding,
        imagesByPlan: {
          'variant-1': Array.from({ length: 6 }, () => ({ fileId: 'id', url: 'https://img' })),
        },
        replacementDraftIds: { 'variant-1': '1601935213152' },
        replacementConfirmed: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(storedTaskInput.items[0].replacesDraftProductId, '1601935213152');
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch', plans: [] }),
    createObsidianVariants: () => [{ planId: 'variant-1' }],
    readSellingPointBinding: async () => sellingPointBinding,
    validateSellingPointBinding: (_schemaXml, binding) => binding,
    listCompletedObsidianPlanIds: async () => ['variant-1'],
    listObsidianDrafts: async () => [{
      relativePath: 'batch.md', basePlanId: 'base', sourceProductId: '1601933369105',
      planId: 'variant-1', draftProductId: '1601935213152',
    }],
    createStrictProductPreview: (_schemaXml, variant) => ({
      fingerprint: `hash-${variant.planId}`, previewXml: '<preview />', changedFields: ['sellingPoints'],
    }),
    createObsidianPublishingTask: async (_rootDir, input) => {
      storedTaskInput = input;
      return { id: 'replacement-task', version: 1 };
    },
  });
});

test('POST /api/obsidian/draft requires confirmation and creates one fingerprint-bound draft', async () => {
  let draftCalls = 0;
  await withServer(async (baseUrl) => {
    const previewResponse = await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'batch.md',
        basePlanId: 'base',
        sourceContext: {
          sourceProductId: '1601915922577',
          sourceProductType: 'sourcing',
          categoryId: '32905',
          language: 'en_US',
          publishType: 'default',
          version: 'trade.1.1',
          schemaXml: '<itemSchema />',
        },
        planIds: ['variant-1'],
        sellingPointBinding,
        imagesByPlan: { 'variant-1': Array.from({ length: 6 }, () => ({ fileId: 'id', url: 'https://img' })) },
      }),
    });
    const prepared = await previewResponse.json();
    assert.match(prepared.sessionId, /^[0-9a-f-]{36}$/);
    assert.match(prepared.taskId, /^[0-9a-f-]{36}$/);

    const blocked = await fetch(`${baseUrl}/api/obsidian/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: prepared.sessionId, planId: 'variant-1', fingerprint: 'hash-variant-1' }),
    });
    assert.equal(blocked.status, 400);
    assert.equal(draftCalls, 0);

    const response = await fetch(`${baseUrl}/api/obsidian/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: 'key' },
        sessionId: prepared.sessionId,
        planId: 'variant-1',
        fingerprint: 'hash-variant-1',
        confirmed: true,
      }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.item.status, 'draft_created');
    assert.equal(result.item.draftProductId, 'draft-variant-1');
    assert.equal(draftCalls, 1);

    const duplicate = await fetch(`${baseUrl}/api/obsidian/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { appKey: 'key' }, sessionId: prepared.sessionId, planId: 'variant-1', fingerprint: 'hash-variant-1', confirmed: true,
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(draftCalls, 1);
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch-1', plans: [] }),
    createObsidianVariants: () => [{ planId: 'variant-1' }],
    readSellingPointBinding: async () => sellingPointBinding,
    validateSellingPointBinding: () => sellingPointBinding,
    createStrictProductPreview: () => ({ previewXml: '<preview />', fingerprint: 'hash-variant-1', changedFields: ['title'] }),
    getAlibabaPublishingCapability: async () => ({ supportPostSourcing: true, supportPostWholesale: false }),
    createAlibabaProductDraft: async (config, input) => {
      draftCalls += 1;
      assert.equal(input.schemaXml, '<preview />');
      assert.equal(input.publishContext.categoryId, '32905');
      return { productId: 'draft-variant-1', traceId: 'trace-1', requestId: 'request-1' };
    },
  });
});

test('POST /api/obsidian/draft marks a timeout unknown and blocks retry', async () => {
  let draftCalls = 0;
  await withServer(async (baseUrl) => {
    const prepared = await (await fetch(`${baseUrl}/api/obsidian/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'batch.md', basePlanId: 'base',
        sourceContext: { sourceProductType: 'sourcing', categoryId: '32905', language: 'en_US', publishType: 'default', version: 'trade.1.1', schemaXml: '<itemSchema />' },
        planIds: ['variant-1'], sellingPointBinding,
        imagesByPlan: { 'variant-1': Array.from({ length: 6 }, () => ({ fileId: 'id', url: 'https://img' })) },
      }),
    })).json();
    const body = {
      config: { appKey: 'key' }, sessionId: prepared.sessionId, planId: 'variant-1', fingerprint: 'hash-variant-1', confirmed: true,
    };
    const response = await fetch(`${baseUrl}/api/obsidian/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).item.status, 'result_unknown');

    const retry = await fetch(`${baseUrl}/api/obsidian/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(retry.status, 409);
    assert.equal(draftCalls, 1);
  }, {
    readObsidianBatch: async () => ({ batchId: 'batch-1', plans: [] }),
    createObsidianVariants: () => [{ planId: 'variant-1' }],
    readSellingPointBinding: async () => sellingPointBinding,
    validateSellingPointBinding: () => sellingPointBinding,
    createStrictProductPreview: () => ({ previewXml: '<preview />', fingerprint: 'hash-variant-1', changedFields: ['title'] }),
    getAlibabaPublishingCapability: async () => ({ supportPostSourcing: true }),
    createAlibabaProductDraft: async () => {
      draftCalls += 1;
      throw new Error('timeout');
    },
  });
});

test('GET /api/obsidian/drafts returns persisted safe draft records', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/drafts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      drafts: [{
        taskId: 'task-1', batchId: 'batch-1', relativePath: 'batch.md', planId: 'plan-2',
        draftProductId: '1601933441594', completedAt: '2026-08-25T10:00:00.000Z',
      }],
    });
  }, {
    listObsidianDrafts: async () => [{
      taskId: 'task-1', batchId: 'batch-1', relativePath: 'batch.md', planId: 'plan-2',
      draftProductId: '1601933441594', completedAt: '2026-08-25T10:00:00.000Z',
    }],
  });
});

test('POST /api/obsidian/draft/verify reads one persisted draft and returns safe comparison only', async () => {
  let received;
  const faqs = Array.from({ length: 5 }, (_, index) => ({ question: `Q${index + 1}?`, answer: `A${index + 1}.` }));
  const customAttributes = Array.from({ length: 10 }, (_, index) => ({ name: `Name ${index + 1}`, value: `Value ${index + 1}` }));
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/draft/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { appKey: 'key', appSecret: 'must-not-leak' }, taskId: 'task-1', planId: 'plan-2' }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('must-not-leak'), false);
    assert.equal(text.includes('<itemSchema'), false);
    assert.deepEqual(JSON.parse(text), {
      taskId: 'task-1',
      planId: 'plan-2',
      draftProductId: '1601933441594',
      traceId: 'trace-1',
      comparison: {
        exactMatch: true,
        fields: {
          title: { match: true, expected: 'Expected title', actual: 'Expected title' },
          sellingPoints: { match: true, expected: 'Expected selling points', actual: 'Expected selling points' },
          faqs: { match: true, expectedCount: 5, actualCount: 5 },
          customAttributes: { match: true, expectedCount: 10, actualCount: 10 },
          images: { match: true, expectedCount: 6, actualCount: 6, completeMetadata: true },
        },
        differences: [],
      },
    });
    assert.deepEqual(received, {
      config: { appKey: 'key', appSecret: 'must-not-leak' },
      input: { productId: '1601933441594', categoryId: '301504', language: 'en_US' },
    });
  }, {
    readObsidianPublishingTask: async () => ({
      id: 'task-1', relativePath: 'batch.md', context: { categoryId: '301504', language: 'en_US' },
      sellingPointBinding,
      items: [{ planId: 'plan-2', status: 'draft_created', draftProductId: '1601933441594' }],
    }),
    readObsidianBatch: async () => ({ plans: [{ id: 'plan-2', title: 'Expected title', sellingPoints: 'Expected selling points', faqs, customAttributes }] }),
    loadAlibabaProductDraft: async (config, input) => {
      received = { config, input };
      return { schemaXml: '<itemSchema />', traceId: 'trace-1' };
    },
    validateSellingPointBinding: () => sellingPointBinding,
    analyzeProductSchema: () => ({
      recognized: {
        title: { value: 'Expected title' },
        productSummary: { value: 'Expected selling points' },
        faq: { items: faqs },
        customAttributes: { items: customAttributes },
        images: { items: Array.from({ length: 6 }, (_, index) => ({ fileId: `file-${index}`, url: `https://img/${index}.jpg` })) },
      },
    }),
  });
});

test('POST /api/obsidian/draft/verify returns Alibaba trace id without raw response data', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/obsidian/draft/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { appKey: 'key' }, taskId: 'task-1', planId: 'plan-2' }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'draft not found', code: 'NOT_FOUND', traceId: 'trace-missing',
    });
  }, {
    readObsidianPublishingTask: async () => ({
      id: 'task-1', relativePath: 'batch.md', context: { categoryId: '301504', language: 'en_US' },
      items: [{ planId: 'plan-2', status: 'draft_created', draftProductId: '1601933441594' }],
    }),
    readObsidianBatch: async () => ({ plans: [{ id: 'plan-2' }] }),
    loadAlibabaProductDraft: async () => {
      throw Object.assign(new Error('draft not found'), { code: 'NOT_FOUND', traceId: 'trace-missing' });
    },
  });
});
