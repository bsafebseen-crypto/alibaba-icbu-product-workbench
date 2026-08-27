import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function requireTaskId(id) {
  const normalized = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error('任务编号无效');
  return normalized;
}

function taskPath(rootDir, id) {
  return path.join(path.resolve(rootDir), 'data', 'tasks', `obsidian-${requireTaskId(id)}.json`);
}

function safeContext(context = {}) {
  return {
    categoryId: String(context.categoryId || ''),
    language: String(context.language || ''),
    publishType: String(context.publishType || ''),
    version: String(context.version || ''),
    sourceProductType: String(context.sourceProductType || ''),
  };
}

function safeSellingPointBinding(binding = {}) {
  const safe = {
    fieldId: String(binding.fieldId || ''),
    carrierPath: Array.isArray(binding.carrierPath)
      ? binding.carrierPath.map((part) => String(part))
      : [],
    structureType: String(binding.structureType || ''),
    categoryId: String(binding.categoryId || ''),
    language: String(binding.language || ''),
    version: String(binding.version || ''),
  };
  return safe.fieldId && safe.carrierPath.length && safe.structureType ? safe : null;
}

function safeItem(item = {}) {
  return Object.fromEntries(Object.entries({
    planId: String(item.planId || ''),
    fingerprint: String(item.fingerprint || ''),
    status: String(item.status || ''),
    attemptStartedAt: item.attemptStartedAt,
    draftProductId: item.draftProductId,
    traceId: item.traceId,
    requestId: item.requestId,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    completedAt: item.completedAt,
  }).filter(([, value]) => value !== undefined && value !== ''));
}

async function writeAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

export async function createObsidianPublishingTask(rootDir, input = {}, requestedId) {
  const id = requireTaskId(requestedId || crypto.randomUUID());
  const now = new Date().toISOString();
  const task = {
    id,
    kind: 'obsidian-publishing',
    version: 1,
    batchId: String(input.batchId || ''),
    relativePath: String(input.relativePath || ''),
    basePlanId: String(input.basePlanId || ''),
    sourceProductId: String(input.sourceProductId || ''),
    context: safeContext(input.context),
    ...(safeSellingPointBinding(input.sellingPointBinding)
      ? { sellingPointBinding: safeSellingPointBinding(input.sellingPointBinding) }
      : {}),
    items: Array.isArray(input.items) ? input.items.map(safeItem) : [],
    createdAt: now,
    updatedAt: now,
  };
  await writeAtomic(taskPath(rootDir, id), task);
  return task;
}

export async function readObsidianPublishingTask(rootDir, id) {
  const filePath = taskPath(rootDir, id);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('Obsidian 上品任务不存在'), { status: 404 });
    throw error;
  }
}

export async function listObsidianDrafts(rootDir) {
  const directory = path.join(path.resolve(rootDir), 'data', 'tasks');
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const tasks = await Promise.all(names
    .filter((name) => /^obsidian-[A-Za-z0-9_-]+\.json$/.test(name))
    .map(async (name) => JSON.parse(await readFile(path.join(directory, name), 'utf8'))));
  return tasks.flatMap((task) => (Array.isArray(task.items) ? task.items : [])
    .filter((item) => item.status === 'draft_created' && item.draftProductId)
    .map((item) => Object.fromEntries(Object.entries({
      taskId: String(task.id || ''),
      batchId: String(task.batchId || ''),
      relativePath: String(task.relativePath || ''),
      basePlanId: String(task.basePlanId || ''),
      sourceProductId: String(task.sourceProductId || ''),
      planId: String(item.planId || ''),
      draftProductId: String(item.draftProductId),
      completedAt: String(item.completedAt || ''),
    }).filter(([, value]) => value !== ''))))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

export async function listCompletedObsidianPlanIds(rootDir, identity = {}) {
  const relativePath = String(identity.relativePath || '');
  const basePlanId = String(identity.basePlanId || '');
  const sourceProductId = String(identity.sourceProductId || '');
  if (!relativePath || !basePlanId || !sourceProductId) return [];
  const drafts = await listObsidianDrafts(rootDir);
  return [...new Set(drafts
    .filter((draft) => (
      draft.relativePath === relativePath
      && draft.basePlanId === basePlanId
      && draft.sourceProductId === sourceProductId
    ))
    .map((draft) => draft.planId))];
}

export async function updateObsidianDraftItem(rootDir, id, planId, nextItem, expectedVersion) {
  const task = await readObsidianPublishingTask(rootDir, id);
  if (task.version !== expectedVersion) throw Object.assign(new Error('任务状态已经变化，请刷新后重试'), { status: 409 });
  const index = task.items.findIndex((item) => item.planId === planId);
  if (index < 0) throw new Error(`任务中不存在方案 ${planId}`);
  const updated = {
    ...task,
    version: task.version + 1,
    updatedAt: new Date().toISOString(),
    items: task.items.map((item, itemIndex) => itemIndex === index ? safeItem(nextItem) : item),
  };
  await writeAtomic(taskPath(rootDir, id), updated);
  return updated;
}
