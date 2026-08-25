import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateProducts as defaultGenerateProducts,
  generateSimilarProducts as defaultGenerateSimilarProducts,
  testAiConnection as defaultTestAiConnection,
} from './ai-client.js';
import {
  createAlibabaProductDraft as defaultCreateAlibabaProductDraft,
  exchangeAlibabaCode as defaultExchangeAlibabaCode,
  getAlibabaPublishingCapability as defaultGetAlibabaPublishingCapability,
  loadAlibabaProductContext as defaultLoadAlibabaProductContext,
  loadAlibabaProductTemplate as defaultLoadAlibabaProductTemplate,
  refreshAlibabaToken as defaultRefreshAlibabaToken,
  testAlibabaConnection as defaultTestAlibabaConnection,
  uploadAlibabaPhoto as defaultUploadAlibabaPhoto,
} from './alibaba-client.js';
import { createManualProducts, createSimilarProductsFromTemplate } from './core.js';
import { parseKeywordWorkbook as defaultParseKeywordWorkbook } from './keyword-workbook.js';
import {
  DEFAULT_OBSIDIAN_ROOT,
  listObsidianBatches as defaultListObsidianBatches,
  readObsidianBatch as defaultReadObsidianBatch,
} from './obsidian-listing.js';
import {
  createObsidianVariants as defaultCreateObsidianVariants,
  createStrictProductPreview as defaultCreateStrictProductPreview,
} from './obsidian-variant.js';
import {
  createObsidianPublishingTask as defaultCreateObsidianPublishingTask,
  readObsidianPublishingTask as defaultReadObsidianPublishingTask,
  updateObsidianDraftItem as defaultUpdateObsidianDraftItem,
} from './obsidian-task-store.js';
import {
  beginDraftAttempt,
  failDraftAttempt,
  finishDraftAttempt,
  markDraftResultUnknown,
} from './publishing-state.js';
import {
  analyzeProductSchema as defaultAnalyzeProductSchema,
  createProductPreview as defaultCreateProductPreview,
} from './schema-template.js';
import {
  listTasks as defaultListTasks,
  readTask as defaultReadTask,
  saveTask,
} from './task-store.js';

const BODY_LIMIT = 10 * 1024 * 1024;
const IMAGE_GENERATION_BODY_LIMIT = 24 * 1024 * 1024;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function serveStatic(rootDir, pathname, response) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/similar-product-ui.js': ['similar-product-ui.js', 'text/javascript; charset=utf-8'],
    '/product-pool.js': ['product-pool.js', 'text/javascript; charset=utf-8'],
    '/obsidian-publishing.js': ['obsidian-publishing.js', 'text/javascript; charset=utf-8'],
  };
  const entry = files[pathname];
  if (!entry) return false;

  try {
    const body = await readFile(path.join(rootDir, 'public', entry[0]));
    response.writeHead(200, {
      'Content-Type': entry[1],
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(request, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error(`请求内容不能超过 ${Math.round(limit / 1024 / 1024)} MB`), { status: 413 });
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('请求内容不是有效 JSON'), { status: 400 });
  }
}

async function readBuffer(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('文件不能超过 10 MB'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error('请选择要上传的 Excel 文件'), { status: 400 });
  return Buffer.concat(chunks);
}

function decodeImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match) throw Object.assign(new Error('图片数据格式无效'), { status: 400 });
  const imageBytes = Buffer.from(match[2], 'base64');
  if (!imageBytes.length) throw Object.assign(new Error('图片内容为空'), { status: 400 });
  if (imageBytes.length > BODY_LIMIT) {
    throw Object.assign(new Error('单张图片不能超过 10 MB'), { status: 413 });
  }
  return { mimeType: match[1], imageBytes };
}

export function createServer(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const testAiConnection = options.testAiConnection ?? defaultTestAiConnection;
  const testAlibabaConnection = options.testAlibabaConnection ?? defaultTestAlibabaConnection;
  const exchangeAlibabaCode = options.exchangeAlibabaCode ?? defaultExchangeAlibabaCode;
  const refreshAlibabaToken = options.refreshAlibabaToken ?? defaultRefreshAlibabaToken;
  const loadAlibabaProductTemplate = options.loadAlibabaProductTemplate ?? defaultLoadAlibabaProductTemplate;
  const loadAlibabaProductContext = options.loadAlibabaProductContext ?? defaultLoadAlibabaProductContext;
  const uploadAlibabaPhoto = options.uploadAlibabaPhoto ?? defaultUploadAlibabaPhoto;
  const generateProducts = options.generateProducts ?? defaultGenerateProducts;
  const generateSimilarProducts = options.generateSimilarProducts ?? defaultGenerateSimilarProducts;
  const parseKeywordWorkbook = options.parseKeywordWorkbook ?? defaultParseKeywordWorkbook;
  const analyzeProductSchema = options.analyzeProductSchema ?? defaultAnalyzeProductSchema;
  const createProductPreview = options.createProductPreview ?? defaultCreateProductPreview;
  const listTasks = options.listTasks ?? defaultListTasks;
  const readTask = options.readTask ?? defaultReadTask;
  const obsidianRoot = options.obsidianRoot ?? DEFAULT_OBSIDIAN_ROOT;
  const listObsidianBatches = options.listObsidianBatches ?? defaultListObsidianBatches;
  const readObsidianBatch = options.readObsidianBatch ?? defaultReadObsidianBatch;
  const createObsidianVariants = options.createObsidianVariants ?? defaultCreateObsidianVariants;
  const createStrictProductPreview = options.createStrictProductPreview ?? defaultCreateStrictProductPreview;
  const createAlibabaProductDraft = options.createAlibabaProductDraft ?? defaultCreateAlibabaProductDraft;
  const getAlibabaPublishingCapability = options.getAlibabaPublishingCapability ?? defaultGetAlibabaPublishingCapability;
  const createObsidianPublishingTask = options.createObsidianPublishingTask ?? defaultCreateObsidianPublishingTask;
  const readObsidianPublishingTask = options.readObsidianPublishingTask ?? defaultReadObsidianPublishingTask;
  const updateObsidianDraftItem = options.updateObsidianDraftItem ?? defaultUpdateObsidianDraftItem;
  const previewSessions = new Map();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        sendJson(response, 200, await listTasks(rootDir));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/obsidian/batches') {
        sendJson(response, 200, {
          rootAvailable: true,
          batches: await listObsidianBatches(obsidianRoot),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/obsidian/batch') {
        const body = await readJson(request);
        try {
          sendJson(response, 200, await readObsidianBatch(obsidianRoot, body.relativePath));
        } catch (error) {
          if (!error.status) error.status = error.code === 'ENOENT' ? 404 : 400;
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/obsidian/source-product') {
        const body = await readJson(request);
        const context = await loadAlibabaProductContext(body.config, { productId: body.productId });
        sendJson(response, 200, {
          ...context,
          analysis: analyzeProductSchema(context.schemaXml),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/obsidian/preview') {
        const body = await readJson(request);
        try {
          const batch = await readObsidianBatch(obsidianRoot, body.relativePath);
          const variants = createObsidianVariants(batch, body.basePlanId);
          const schemaXml = body.sourceContext?.schemaXml || body.schemaXml;
          const previews = variants.map((variant) => {
            const alibabaImages = body.imagesByPlan?.[variant.planId];
            if (!Array.isArray(alibabaImages) || alibabaImages.length !== 6) {
              throw new Error(`${variant.planId} 必须分配并上传 6 张图片`);
            }
            return {
              planId: variant.planId,
              ...createStrictProductPreview(schemaXml, { ...variant, alibabaImages }),
            };
          });
          const sessionId = crypto.randomUUID();
          const context = {
            categoryId: body.sourceContext?.categoryId,
            language: body.sourceContext?.language,
            publishType: body.sourceContext?.publishType,
            version: body.sourceContext?.version,
            sourceProductType: body.sourceContext?.sourceProductType,
          };
          const task = await createObsidianPublishingTask(rootDir, {
            batchId: batch.batchId,
            relativePath: body.relativePath,
            basePlanId: body.basePlanId,
            sourceProductId: body.sourceContext?.sourceProductId,
            context,
            items: previews.map((preview) => ({
              planId: preview.planId,
              fingerprint: preview.fingerprint,
              status: 'preview_ready',
            })),
          });
          previewSessions.set(sessionId, {
            taskId: task.id,
            context,
            previews: new Map(previews.map((preview) => [preview.planId, {
              previewXml: preview.previewXml,
              fingerprint: preview.fingerprint,
            }])),
          });
          sendJson(response, 200, {
            previews,
            sessionId,
            taskId: task.id,
            taskVersion: task.version,
          });
        } catch (error) {
          if (!error.status) error.status = error.code === 'ENOENT' ? 404 : 400;
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/obsidian/draft') {
        const body = await readJson(request);
        if (body.confirmed !== true) {
          throw Object.assign(new Error('创建草稿前必须逐商品明确确认'), { status: 400 });
        }
        const session = previewSessions.get(String(body.sessionId || ''));
        if (!session) throw Object.assign(new Error('预览会话已失效，请重新生成完整预览'), { status: 409 });
        const preview = session.previews.get(String(body.planId || ''));
        if (!preview) throw Object.assign(new Error('预览会话中不存在这个方案'), { status: 400 });

        let task = await readObsidianPublishingTask(rootDir, session.taskId);
        const item = task.items.find((candidate) => candidate.planId === body.planId);
        if (!item) throw Object.assign(new Error('任务中不存在这个方案'), { status: 400 });
        if (item.status !== 'preview_ready') {
          throw Object.assign(new Error('当前状态不允许再次创建草稿'), { status: 409 });
        }
        if (body.fingerprint !== preview.fingerprint || item.fingerprint !== preview.fingerprint) {
          throw Object.assign(new Error('预览已经变化，请重新生成并确认'), { status: 409 });
        }

        const capability = await getAlibabaPublishingCapability(body.config, {
          categoryId: session.context.categoryId,
          language: session.context.language,
        });
        const sourceType = String(session.context.sourceProductType || '').toLocaleLowerCase();
        const allowed = sourceType === 'sourcing'
          ? capability.supportPostSourcing
          : capability.supportPostWholesale;
        if (!allowed) throw Object.assign(new Error('当前账号没有这个类目和商品类型的发品权限'), { status: 403 });

        const submitting = beginDraftAttempt(item, body.fingerprint, new Date().toISOString());
        task = await updateObsidianDraftItem(
          rootDir, session.taskId, body.planId, submitting, task.version,
        );
        try {
          const result = await createAlibabaProductDraft(body.config, {
            schemaXml: preview.previewXml,
            publishContext: session.context,
          });
          const completed = finishDraftAttempt(submitting, result, new Date().toISOString());
          task = await updateObsidianDraftItem(
            rootDir, session.taskId, body.planId, completed, task.version,
          );
          sendJson(response, 201, { taskId: task.id, taskVersion: task.version, item: completed });
        } catch (error) {
          const completed = error.definitive === true
            ? failDraftAttempt(submitting, error, new Date().toISOString())
            : markDraftResultUnknown(submitting, error, new Date().toISOString());
          task = await updateObsidianDraftItem(
            rootDir, session.taskId, body.planId, completed, task.version,
          );
          sendJson(response, error.definitive === true ? 422 : 502, {
            error: completed.errorMessage,
            taskId: task.id,
            taskVersion: task.version,
            item: completed,
          });
        }
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/tasks/'.length));
        sendJson(response, 200, await readTask(rootDir, id));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/test') {
        const config = await readJson(request);
        sendJson(response, 200, await testAiConnection(config));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/alibaba/test') {
        const config = await readJson(request);
        sendJson(response, 200, await testAlibabaConnection(config));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/alibaba/token') {
        const body = await readJson(request);
        sendJson(response, 200, await exchangeAlibabaCode(body.config, body.code));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/alibaba/token/refresh') {
        const body = await readJson(request);
        sendJson(response, 200, await refreshAlibabaToken(body.config, body.refreshToken));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/alibaba/product-template') {
        const body = await readJson(request);
        const template = await loadAlibabaProductTemplate(body.config, body.productId);
        sendJson(response, 200, {
          ...template,
          analysis: analyzeProductSchema(template.schemaXml),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/alibaba/photobank/upload') {
        const body = await readJson(request, IMAGE_GENERATION_BODY_LIMIT);
        const decoded = decodeImageDataUrl(body.image?.dataUrl);
        const result = await uploadAlibabaPhoto(body.config, {
          fileName: body.image?.fileName,
          mimeType: decoded.mimeType,
          imageBytes: decoded.imageBytes,
          groupId: body.groupId,
          extraContext: body.extraContext,
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/products/manual') {
        await readJson(request);
        sendJson(response, 200, { products: createManualProducts() });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/products/similar') {
        const body = await readJson(request);
        sendJson(response, 200, { products: createSimilarProductsFromTemplate(body.productId) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/products/preview') {
        const body = await readJson(request);
        if (!Array.isArray(body.products) || body.products.length !== 4) {
          throw Object.assign(new Error('预览必须正好包含 4 个类似品'), { status: 400 });
        }
        const previews = body.products.map((product) => ({
          index: product.index,
          sourceProductId: product.sourceProductId,
          status: 'preview',
          ...createProductPreview(body.schemaXml, product),
        }));
        sendJson(response, 200, { previews });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/keywords/xlsx') {
        const result = await parseKeywordWorkbook(await readBuffer(request));
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/products/generate') {
        const body = await readJson(request);
        const products = await generateProducts(body.config, body.source);
        sendJson(response, 200, { products });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/products/generate-similar') {
        const body = await readJson(request, IMAGE_GENERATION_BODY_LIMIT);
        const generated = await generateSimilarProducts(body.config, body.source);
        sendJson(response, 200, {
          products: generated.products,
          visionUsed: generated.visionUsed === true,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        const task = await readJson(request);
        const saved = await saveTask(rootDir, task);
        sendJson(response, 201, { id: saved.id, task: saved.task });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: '接口不存在' });
        return;
      }

      if (request.method === 'GET' && await serveStatic(rootDir, url.pathname, response)) {
        return;
      }

      sendJson(response, 404, { error: '页面不存在' });
    } catch (error) {
      sendJson(response, error.status ?? 500, { error: error.message || '服务器内部错误' });
    }
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const port = Number(process.env.ICBU_WORKBENCH_PORT || 54025);
  const server = createServer({ rootDir: process.cwd() });
  server.listen(port, '127.0.0.1', () => {
    console.log(`国际站自动上品工作台：http://127.0.0.1:${port}/`);
  });
}
