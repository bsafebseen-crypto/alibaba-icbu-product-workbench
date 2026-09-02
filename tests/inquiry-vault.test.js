import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createInquiryVaultStore } from '../src/inquiry-vault.js';

test('vault encrypts records and forgets the key when locked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('correct horse battery staple');
  await vault.write('conversations', 'conv-1', { accountId: 'seller-01', content: 'private chat' });

  const files = await readdir(path.join(root, 'data', 'inquiry-review', 'conversations'));
  const raw = await readFile(path.join(root, 'data', 'inquiry-review', 'conversations', files[0]), 'utf8');
  assert.doesNotMatch(raw, /conv-1|seller-01|private chat/);

  vault.lock();
  await assert.rejects(() => vault.read('conversations', 'conv-1'), /资料库尚未解锁/);
  await vault.unlock('correct horse battery staple');
  assert.equal((await vault.read('conversations', 'conv-1')).content, 'private chat');
});

test('vault rejects a wrong password and authenticated-data corruption', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('first password value');
  await vault.write('settings', 'configuration', { enabled: true });
  vault.lock();
  await assert.rejects(() => vault.unlock('wrong password value'), /资料库密码错误/);

  const directory = path.join(root, 'data', 'inquiry-review', 'settings');
  const [name] = await readdir(directory);
  const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  record.tag = Buffer.alloc(16).toString('base64');
  await writeFile(path.join(directory, name), JSON.stringify(record), 'utf8');
  await vault.unlock('first password value');
  await assert.rejects(() => vault.read('settings', 'configuration'), /资料库记录已损坏/);
});

test('prune removes messages older than exactly 90 days and dependent empty reviews', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('retention password');
  await vault.write('conversations', 'conv-1', {
    accountId: 'seller-01',
    messages: [
      { messageId: 'old', sendTime: 1 },
      { messageId: 'new', sendTime: 90 * 86400000 + 2 },
    ],
  });
  await vault.write('conversations', 'conv-2', {
    accountId: 'seller-01',
    messages: [{ messageId: 'expired', sendTime: 1 }],
  });
  await vault.write('reviews', 'review-2', { conversationId: 'conv-2' });

  await vault.prune(180 * 86400000 + 1);

  assert.deepEqual((await vault.read('conversations', 'conv-1')).messages.map((item) => item.messageId), ['new']);
  assert.equal(await vault.read('conversations', 'conv-2'), null);
  assert.equal(await vault.read('reviews', 'review-2'), null);
});

test('vault rejects record deletion while locked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('locked mutation password');
  await vault.write('accounts', 'seller-01', { accountId: 'seller-01' });
  vault.lock();

  await assert.rejects(() => vault.remove('accounts', 'seller-01'), /资料库尚未解锁/);
});

test('password changes reject every wrong old password without changing the vault', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('current vault password');
  await vault.write('settings', 'configuration', { locale: 'zh-CN' });

  await assert.rejects(
    () => vault.changePassword('short', 'replacement vault password'),
    /资料库密码错误/,
  );
  vault.lock();
  await vault.unlock('current vault password');
  assert.deepEqual(await vault.read('settings', 'configuration'), { locale: 'zh-CN' });
});

test('password changes re-encrypt existing records for the replacement password', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('current vault password');
  await vault.write('settings', 'configuration', { locale: 'zh-CN' });

  await vault.changePassword('current vault password', 'replacement vault password');
  vault.lock();
  await assert.rejects(() => vault.unlock('current vault password'), /资料库密码错误/);
  await vault.unlock('replacement vault password');
  assert.deepEqual(await vault.read('settings', 'configuration'), { locale: 'zh-CN' });
});

test('account clearing is scoped and clearAll preserves an unlocked vault', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('scoped clearing password');
  await vault.write('accounts', 'seller-01', { accountId: 'seller-01' });
  await vault.write('accounts', 'seller-02', { accountId: 'seller-02' });
  await vault.write('conversations', 'conv-1', { accountId: 'seller-01', messages: [] });
  await vault.write('reviews', 'review-1', { conversationId: 'conv-1' });
  await vault.write('cursors', 'seller-01', { page: 2 });
  await vault.write('settings', 'configuration', { locale: 'zh-CN' });

  await vault.clearAccount('seller-01');
  assert.equal(await vault.read('accounts', 'seller-01'), null);
  assert.equal(await vault.read('conversations', 'conv-1'), null);
  assert.equal(await vault.read('reviews', 'review-1'), null);
  assert.equal(await vault.read('cursors', 'seller-01'), null);
  assert.deepEqual(await vault.list('accounts'), [{ accountId: 'seller-02' }]);
  assert.deepEqual(await vault.read('settings', 'configuration'), { locale: 'zh-CN' });

  assert.equal(await vault.remove('settings', 'configuration'), true);
  assert.equal(await vault.remove('settings', 'configuration'), false);
  await vault.clearAll();
  assert.deepEqual(await vault.list('accounts'), []);
  assert.deepEqual(await vault.status(), { exists: true, locked: false, version: 1 });
});
