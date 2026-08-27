import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolvePhotobankCache,
  savePhotobankCacheEntry,
} from '../src/photobank-cache.js';

test('photobank cache persists only safe basename and upload metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'photobank-cache-'));
  const digest = 'a'.repeat(64);
  const saved = await savePhotobankCacheEntry(root, {
    sha256: digest,
    fileName: 'C:\\secret-folder\\1.jpg',
    size: 65981,
    mimeType: 'image/jpeg',
    fileId: 'file-1',
    photobankUrl: 'https://img.example.com/1.jpg',
    source: 'upload',
    accessToken: 'must-not-persist',
    dataUrl: 'data:image/jpeg;base64,AAA',
  });

  assert.equal(saved.fileName, '1.jpg');
  const resolved = await resolvePhotobankCache(root, [digest, 'b'.repeat(64)]);
  assert.deepEqual(Object.keys(resolved), [digest]);
  assert.equal(resolved[digest].fileId, 'file-1');
  const raw = await readFile(path.join(root, 'data', 'photobank-cache.json'), 'utf8');
  assert.doesNotMatch(raw, /secret-folder|must-not-persist|base64|dataUrl|accessToken/);
});

test('photobank cache normalizes Alibaba HTTP URLs and blocks malformed or conflicting mappings', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'photobank-cache-'));
  const entry = {
    sha256: 'c'.repeat(64), fileName: '1.jpg', size: 10, mimeType: 'image/jpeg',
    fileId: 'file-1', photobankUrl: 'https://img.example.com/1.jpg', source: 'upload',
  };
  await savePhotobankCacheEntry(root, entry);
  await assert.rejects(
    savePhotobankCacheEntry(root, { ...entry, fileId: 'file-2' }),
    /图片缓存映射冲突/,
  );
  await assert.rejects(
    savePhotobankCacheEntry(root, { ...entry, sha256: 'bad' }),
    /SHA-256 无效/,
  );
  const upgraded = await savePhotobankCacheEntry(root, {
    ...entry, sha256: 'd'.repeat(64), photobankUrl: 'http://img.alicdn.com/generated.jpg',
  });
  assert.equal(upgraded.photobankUrl, 'https://img.alicdn.com/generated.jpg');
  await assert.rejects(
    savePhotobankCacheEntry(root, { ...entry, sha256: 'e'.repeat(64), photobankUrl: 'ftp://unsafe' }),
    /图片银行地址格式无效/,
  );
});
