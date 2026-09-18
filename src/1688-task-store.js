import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_KEY = /(?:access|refresh)?[_-]?token|app[_-]?secret|client[_-]?secret|authorization|auth[_-]?code|image[_-]?bytes/i;

function requireTaskId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('1688 任务编号无效');
  return id;
}
function filePath(rootDir, id) {
  return path.join(path.resolve(rootDir), 'data', 'tasks', `1688-${requireTaskId(id)}.json`);
}

function sanitize(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(sanitize).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, sanitize(item)])
    .filter(([, item]) => item !== undefined));
}

function safePayload(input = {}) {
  const sanitized = sanitize(input);
  for (const key of ['id', 'kind', 'version', 'createdAt', 'updatedAt']) delete sanitized[key];
  return sanitized;
}

async function writeAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

export async function create1688Task(rootDir, input = {}, requestedId) {
  const id = requireTaskId(requestedId || crypto.randomUUID());
  const now = new Date().toISOString();
  const task = {
    id,
    kind: '1688-publishing',
    version: 1,
    ...safePayload(input),
    createdAt: now,
    updatedAt: now,
  };
  await writeAtomic(filePath(rootDir, id), task);
  return task;
}

export async function read1688Task(rootDir, id) {
  try {
    return JSON.parse(await readFile(filePath(rootDir, id), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error('1688 发品任务不存在'), { status: 404 });
    }
    throw error;
  }
}

export async function update1688Task(rootDir, id, nextTask, expectedVersion) {
  const current = await read1688Task(rootDir, id);
  if (current.version !== expectedVersion) {
    throw Object.assign(new Error('1688 任务状态已经变化，请刷新后重试'), { status: 409 });
  }
  const updated = {
    id: current.id,
    kind: '1688-publishing',
    version: current.version + 1,
    ...safePayload(nextTask),
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomic(filePath(rootDir, id), updated);
  return updated;
}

export async function list1688Tasks(rootDir) {
  const directory = path.join(path.resolve(rootDir), 'data', 'tasks');
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const tasks = await Promise.all(names
    .filter((name) => /^1688-[A-Za-z0-9_-]+\.json$/.test(name))
    .map((name) => readFile(path.join(directory, name), 'utf8').then(JSON.parse)));
  return tasks.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}
