import crypto from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function configPath(rootDir) {
  return path.join(path.resolve(rootDir), 'data', 'fixed-images.json');
}

async function inspectFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const mimeType = MIME_BY_EXTENSION.get(path.extname(resolved).toLowerCase());
  if (!mimeType) throw new Error('固定副图仅支持 JPG、PNG 或 WebP');
  const [bytes, details] = await Promise.all([readFile(resolved), stat(resolved)]);
  return {
    filePath: resolved,
    fileName: path.basename(resolved),
    size: details.size,
    mimeType,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

async function writeAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

export async function saveFixedImageConfig(rootDir, input = {}) {
  if (!Array.isArray(input.slots) || input.slots.length !== 2) {
    throw new Error('必须配置 2 张固定副图');
  }
  const slots = await Promise.all(input.slots.map(async (slot) => {
    const name = String(slot?.name || '').trim();
    if (!name) throw new Error('固定副图槽位名称不能为空');
    return { name, ...await inspectFile(slot.filePath) };
  }));
  await writeAtomic(configPath(rootDir), { slots });
  return { slots: slots.map((slot) => ({ ...slot, ready: true })) };
}

export async function readFixedImageConfig(rootDir) {
  let stored;
  try {
    stored = JSON.parse(await readFile(configPath(rootDir), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { slots: [] };
    throw error;
  }
  const slots = await Promise.all((Array.isArray(stored.slots) ? stored.slots : []).map(async (slot) => {
    try {
      const current = await inspectFile(slot.filePath);
      return {
        name: String(slot.name || ''),
        ...current,
        ready: current.sha256 === String(slot.sha256 || ''),
      };
    } catch {
      return {
        name: String(slot.name || ''),
        filePath: String(slot.filePath || ''),
        fileName: String(slot.fileName || ''),
        size: Number(slot.size || 0),
        mimeType: String(slot.mimeType || ''),
        sha256: String(slot.sha256 || ''),
        ready: false,
      };
    }
  }));
  return { slots };
}
