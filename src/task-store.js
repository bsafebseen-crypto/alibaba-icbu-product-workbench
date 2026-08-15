import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sanitizeTaskForStorage } from './core.js';

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function tasksDirectory(rootDir) {
  return path.resolve(rootDir, 'data', 'tasks');
}

function summarizeTask(task, modifiedAt) {
  const products = Array.isArray(task.products) ? task.products : [];
  const uploads = task.source?.photobankUploads || {};
  return {
    id: String(task.id || ''),
    createdAt: String(task.createdAt || ''),
    updatedAt: modifiedAt.toISOString(),
    status: String(task.status || 'prepared'),
    sourceProductId: String(task.source?.sourceProductId || ''),
    mode: String(task.generation?.mode || 'manual'),
    products: products.map((product) => {
      const assignment = product?.imageAssignment;
      const requiredKeys = [
        `main:${assignment?.mainImageIndex}`,
        ...(assignment?.auxiliaryImageIndexes || []).map((index) => `auxiliary:${index}`),
      ];
      return {
        index: Number(product?.index || 0),
        title: String(product?.title || ''),
        faqCount: Array.isArray(product?.faqItems) ? product.faqItems.length : 0,
        customAttributeCount: Array.isArray(product?.customAttributes)
          ? product.customAttributes.length
          : 0,
        imageReady: requiredKeys.length === 6 && requiredKeys.every((key) => Boolean(
          uploads[key]?.fileId && uploads[key]?.photobankUrl,
        )),
        hasPreview: Boolean(product?.preview?.previewXml),
        previewFields: Array.isArray(product?.preview?.changedFields)
          ? [...product.preview.changedFields]
          : [],
      };
    }),
    imageUploadCount: Object.keys(uploads).length,
    previewCount: products.filter((product) => product?.preview?.previewXml).length,
  };
}

export async function saveTask(rootDir, task) {
  const createdAt = new Date();
  const id = `${dateStamp(createdAt)}-${randomUUID()}`;
  const tasksDir = tasksDirectory(rootDir);
  const filePath = path.join(tasksDir, `${id}.json`);
  const storedTask = sanitizeTaskForStorage({
    ...task,
    id,
    createdAt: createdAt.toISOString(),
    status: 'prepared',
  });

  await mkdir(tasksDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(storedTask, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  return { id, path: filePath, task: storedTask };
}

export async function listTasks(rootDir) {
  const tasksDir = tasksDirectory(rootDir);
  let entries;
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { tasks: [], invalid: [] };
    throw error;
  }

  const tasks = [];
  const invalid = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(tasksDir, entry.name);
    try {
      const [raw, fileStat] = await Promise.all([
        readFile(filePath, 'utf8'),
        stat(filePath),
      ]);
      tasks.push(summarizeTask(JSON.parse(raw), fileStat.mtime));
    } catch {
      invalid.push({ fileName: entry.name, error: '任务文件损坏' });
    }
  }
  tasks.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  invalid.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return { tasks, invalid };
}

export async function readTask(rootDir, id) {
  const taskId = String(id || '');
  if (!/^[A-Za-z0-9-]+$/.test(taskId)) {
    throw Object.assign(new Error('任务编号无效'), { status: 400 });
  }
  try {
    const raw = await readFile(path.join(tasksDirectory(rootDir), `${taskId}.json`), 'utf8');
    return sanitizeTaskForStorage(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw Object.assign(new Error('任务不存在'), { status: 404 });
    }
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error('任务文件损坏'), { status: 422 });
    }
    throw error;
  }
}
