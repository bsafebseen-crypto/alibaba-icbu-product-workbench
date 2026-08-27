import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function cachePath(rootDir) {
  return path.join(path.resolve(rootDir), 'data', 'photobank-cache.json');
}

export function normalizeImageDigest(value) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('图片 SHA-256 无效');
  return digest;
}

function normalizeEntry(entry = {}) {
  const sha256 = normalizeImageDigest(entry.sha256);
  const fileName = String(entry.fileName || '').trim().split(/[\\/]/).pop();
  const size = Number(entry.size);
  const mimeType = String(entry.mimeType || '').trim().toLowerCase();
  const fileId = String(entry.fileId || '').trim();
  const photobankUrl = String(entry.photobankUrl || '').trim();
  const source = String(entry.source || '').trim();
  if (!fileName || !Number.isFinite(size) || size < 0) throw new Error('图片文件元数据无效');
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('图片 MIME 类型无效');
  if (!fileId) throw new Error('图片银行 fileId 不能为空');
  if (!/^https:\/\//i.test(photobankUrl)) throw new Error('图片银行地址必须使用 HTTPS');
  if (!['upload', 'photobank-list'].includes(source)) throw new Error('图片缓存来源无效');
  return {
    sha256, fileName, size, mimeType, fileId, photobankUrl, source,
    verifiedAt: String(entry.verifiedAt || new Date().toISOString()),
  };
}

async function readCache(rootDir) {
  try {
    const parsed = JSON.parse(await readFile(cachePath(rootDir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

export async function resolvePhotobankCache(rootDir, digests = []) {
  const cache = await readCache(rootDir);
  return Object.fromEntries(digests.map(normalizeImageDigest).flatMap((digest) => {
    try {
      const entry = normalizeEntry(cache[digest]);
      return [[digest, entry]];
    } catch {
      return [];
    }
  }));
}

export async function savePhotobankCacheEntry(rootDir, input = {}) {
  const entry = normalizeEntry(input);
  const cache = await readCache(rootDir);
  const existing = cache[entry.sha256];
  if (existing && (
    String(existing.fileId || '') !== entry.fileId
    || String(existing.photobankUrl || '') !== entry.photobankUrl
  )) {
    throw new Error('图片缓存映射冲突');
  }
  cache[entry.sha256] = entry;
  await writeAtomic(cachePath(rootDir), cache);
  return entry;
}
