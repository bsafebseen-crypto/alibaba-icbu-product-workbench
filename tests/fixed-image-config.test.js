import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  readFixedImageConfig,
  saveFixedImageConfig,
} from '../src/fixed-image-config.js';

test('fixed image config hashes exactly two explicit files and revalidates them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixed-config-'));
  const files = [path.join(root, '2.jpg'), path.join(root, '证书主图.jpg')];
  await writeFile(files[0], Buffer.from([1, 2, 3]));
  await writeFile(files[1], Buffer.from([4, 5, 6]));

  const saved = await saveFixedImageConfig(root, {
    slots: [
      { name: '通用图', filePath: files[0] },
      { name: '证书图', filePath: files[1] },
    ],
    accessToken: 'must-not-persist',
  });
  assert.equal(saved.slots.length, 2);
  assert.equal(saved.slots.every((slot) => slot.ready && /^[a-f0-9]{64}$/.test(slot.sha256)), true);

  await writeFile(files[0], Buffer.from([9, 9, 9]));
  const reread = await readFixedImageConfig(root);
  assert.equal(reread.slots[0].ready, false);
  assert.equal(reread.slots[1].ready, true);
  const raw = await readFile(path.join(root, 'data', 'fixed-images.json'), 'utf8');
  assert.doesNotMatch(raw, /must-not-persist|base64/);
});

test('fixed image config requires two jpg png or webp files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixed-config-'));
  const filePath = path.join(root, 'one.jpg');
  await writeFile(filePath, Buffer.from([1]));
  await assert.rejects(
    saveFixedImageConfig(root, { slots: [{ name: 'only', filePath }] }),
    /必须配置 2 张固定副图/,
  );
});
