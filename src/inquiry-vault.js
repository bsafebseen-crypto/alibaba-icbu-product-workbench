import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BUCKETS = new Set(['settings', 'accounts', 'conversations', 'reviews', 'cursors']);
const CHECK_VALUE = 'inquiry-vault-check-v1';

function deriveKey(password, salt) {
  if (String(password).length < 12) throw new Error('资料库密码至少需要 12 个字符');
  return crypto.scryptSync(String(password), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function seal(key, value, authenticatedData) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('资料库记录必须是可序列化数据');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(authenticatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  return {
    version: VERSION,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function unseal(key, encrypted, authenticatedData) {
  if (!encrypted || encrypted.version !== VERSION
    || typeof encrypted.nonce !== 'string'
    || typeof encrypted.tag !== 'string'
    || typeof encrypted.ciphertext !== 'string') {
    throw new Error('invalid encrypted record');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'));
  decipher.setAAD(Buffer.from(authenticatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

function recordName(id) {
  return `${crypto.createHash('sha256').update(String(id), 'utf8').digest('hex')}.enc`;
}

function requireBucket(bucket) {
  if (!BUCKETS.has(bucket)) throw new Error('资料库类别无效');
  return bucket;
}

function requireId(id) {
  const normalized = String(id || '').trim();
  if (!normalized) throw new Error('资料库记录编号不能为空');
  return normalized;
}

function recordPath(vaultDir, bucket, id) {
  return path.join(vaultDir, bucket, recordName(id));
}

function recordAuthenticatedData(bucket, fileName) {
  return `inquiry-vault:${bucket}:${fileName}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

async function recordFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.enc$/.test(entry.name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function metadataFor(key, salt) {
  return {
    version: VERSION,
    salt: salt.toString('base64'),
    kdf: { name: 'scrypt', N: 16384, r: 8, p: 1, keyLength: 32 },
    check: seal(key, { value: CHECK_VALUE }, 'inquiry-vault:metadata'),
  };
}

async function readMetadata(vaultDir) {
  const metadata = await readJson(path.join(vaultDir, 'vault.json'));
  if (metadata?.version !== VERSION || typeof metadata.salt !== 'string' || !metadata.check) {
    throw new Error('资料库元数据损坏');
  }
  return metadata;
}

function verifyCheck(key, metadata) {
  const check = unseal(key, metadata.check, 'inquiry-vault:metadata');
  if (check?.value !== CHECK_VALUE) throw new Error('invalid vault password');
}

async function readRecord(vaultDir, key, bucket, id) {
  const fileName = recordName(id);
  try {
    const encrypted = await readJson(path.join(vaultDir, bucket, fileName));
    const record = unseal(key, encrypted, recordAuthenticatedData(bucket, fileName));
    if (!record || record.id !== id || recordName(record.id) !== fileName) throw new Error('invalid record identity');
    return record.value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('资料库记录已损坏');
  }
}

async function listRecords(vaultDir, key, bucket) {
  const directory = path.join(vaultDir, bucket);
  const files = await recordFiles(directory);
  const records = [];
  for (const file of files) {
    try {
      const encrypted = await readJson(path.join(directory, file.name));
      const record = unseal(key, encrypted, recordAuthenticatedData(bucket, file.name));
      if (!record || typeof record.id !== 'string' || recordName(record.id) !== file.name) {
        throw new Error('invalid record identity');
      }
      records.push(record);
    } catch {
      throw new Error('资料库记录已损坏');
    }
  }
  return records;
}

async function writeRecord(vaultDir, key, bucket, id, value) {
  const fileName = recordName(id);
  await writeAtomic(
    path.join(vaultDir, bucket, fileName),
    seal(key, { id, value }, recordAuthenticatedData(bucket, fileName)),
  );
}

async function verifyVault(vaultDir, key) {
  const metadata = await readMetadata(vaultDir);
  verifyCheck(key, metadata);
  for (const bucket of BUCKETS) await listRecords(vaultDir, key, bucket);
}

export function createInquiryVaultStore(rootDir, options = {}) {
  void options;
  const vaultDir = path.join(path.resolve(rootDir), 'data', 'inquiry-review');
  let key = null;

  function requireUnlocked() {
    if (!key) throw new Error('资料库尚未解锁');
    return key;
  }

  async function status() {
    try {
      const metadata = await readMetadata(vaultDir);
      return { exists: true, locked: !key, version: metadata.version };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, locked: true, version: null };
      return { exists: true, locked: !key, version: null };
    }
  }

  async function create(password) {
    if ((await status()).exists) throw new Error('资料库已存在');
    const salt = crypto.randomBytes(16);
    const nextKey = deriveKey(password, salt);
    try {
      await writeAtomic(path.join(vaultDir, 'vault.json'), metadataFor(nextKey, salt));
      key?.fill(0);
      key = nextKey;
    } catch (error) {
      nextKey.fill(0);
      throw error;
    }
  }

  async function unlock(password) {
    let candidate = null;
    try {
      const metadata = await readMetadata(vaultDir);
      candidate = deriveKey(password, Buffer.from(metadata.salt, 'base64'));
      verifyCheck(candidate, metadata);
      key?.fill(0);
      key = candidate;
    } catch {
      candidate?.fill(0);
      throw new Error('资料库密码错误');
    }
  }

  function lock() {
    key?.fill(0);
    key = null;
  }

  async function read(bucket, id) {
    requireBucket(bucket);
    const normalizedId = requireId(id);
    return readRecord(vaultDir, requireUnlocked(), bucket, normalizedId);
  }

  async function write(bucket, id, value) {
    requireBucket(bucket);
    await writeRecord(vaultDir, requireUnlocked(), bucket, requireId(id), value);
  }

  async function list(bucket) {
    requireBucket(bucket);
    return (await listRecords(vaultDir, requireUnlocked(), bucket)).map((record) => record.value);
  }

  async function remove(bucket, id) {
    requireBucket(bucket);
    requireUnlocked();
    const normalizedId = requireId(id);
    try {
      await rm(recordPath(vaultDir, bucket, normalizedId));
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function clearAccount(accountId) {
    const normalizedAccountId = requireId(accountId);
    requireUnlocked();
    const conversations = await listRecords(vaultDir, key, 'conversations');
    const conversationIds = new Set(conversations
      .filter((record) => record.value?.accountId === normalizedAccountId)
      .map((record) => record.id));
    for (const bucket of BUCKETS) {
      const records = bucket === 'conversations' ? conversations : await listRecords(vaultDir, key, bucket);
      for (const record of records) {
        if (record.id === normalizedAccountId
          || record.value?.accountId === normalizedAccountId
          || (bucket === 'reviews' && conversationIds.has(record.value?.conversationId))) {
          await remove(bucket, record.id);
        }
      }
    }
  }

  async function clearAll() {
    requireUnlocked();
    for (const bucket of BUCKETS) {
      const records = await listRecords(vaultDir, key, bucket);
      await Promise.all(records.map((record) => remove(bucket, record.id)));
    }
  }

  async function prune(now) {
    requireUnlocked();
    const cutoff = Number(now) - RETENTION_MS;
    if (!Number.isFinite(cutoff)) throw new Error('清理时间无效');
    const deletedConversationIds = new Set();
    for (const record of await listRecords(vaultDir, key, 'conversations')) {
      const messages = Array.isArray(record.value?.messages) ? record.value.messages : [];
      const retained = messages.filter((message) => (
        !Number.isFinite(Number(message?.sendTime)) || Number(message.sendTime) >= cutoff
      ));
      if (retained.length === 0) {
        await remove('conversations', record.id);
        deletedConversationIds.add(record.id);
      } else if (retained.length !== messages.length) {
        await write('conversations', record.id, { ...record.value, messages: retained });
      }
    }
    for (const record of await listRecords(vaultDir, key, 'reviews')) {
      if (deletedConversationIds.has(record.value?.conversationId)) await remove('reviews', record.id);
    }
  }

  async function changePassword(oldPassword, newPassword) {
    const currentKey = requireUnlocked();
    let oldKey = null;
    let newKey = null;
    const siblingDir = `${vaultDir}.next-${crypto.randomUUID()}`;
    const backupDir = `${vaultDir}.previous-${crypto.randomUUID()}`;
    let oldMoved = false;
    let siblingPromoted = false;
    let oldPasswordVerified = false;
    try {
      const metadata = await readMetadata(vaultDir);
      oldKey = deriveKey(oldPassword, Buffer.from(metadata.salt, 'base64'));
      verifyCheck(oldKey, metadata);
      oldPasswordVerified = true;

      const salt = crypto.randomBytes(16);
      newKey = deriveKey(newPassword, salt);
      await writeAtomic(path.join(siblingDir, 'vault.json'), metadataFor(newKey, salt));
      for (const bucket of BUCKETS) {
        for (const record of await listRecords(vaultDir, currentKey, bucket)) {
          await writeRecord(siblingDir, newKey, bucket, record.id, record.value);
        }
      }
      await verifyVault(siblingDir, newKey);

      await rename(vaultDir, backupDir);
      oldMoved = true;
      await rename(siblingDir, vaultDir);
      siblingPromoted = true;
      try {
        await rm(backupDir, { recursive: true, force: true });
      } catch {
        // The new vault is valid. A recoverable stale sibling is safer than a failed password change.
      }
      currentKey.fill(0);
      key = newKey;
      newKey = null;
    } catch (error) {
      if (oldMoved && !siblingPromoted) {
        try { await rename(backupDir, vaultDir); } catch { /* preserve the original error */ }
      }
      if (siblingPromoted) {
        // A promotion cannot be rolled back safely after success, so keep its verified key active.
        currentKey.fill(0);
        key = newKey;
        newKey = null;
      }
      if (!oldPasswordVerified) throw new Error('资料库密码错误');
      throw error;
    } finally {
      oldKey?.fill(0);
      newKey?.fill(0);
      if (!siblingPromoted) await rm(siblingDir, { recursive: true, force: true });
    }
  }

  return {
    status,
    create,
    unlock,
    lock,
    changePassword,
    read,
    write,
    list,
    remove,
    clearAccount,
    clearAll,
    prune,
  };
}
