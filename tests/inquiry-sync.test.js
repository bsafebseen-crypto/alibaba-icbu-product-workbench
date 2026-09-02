import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquirySyncService, mergeMessages } from '../src/inquiry-sync.js';

function createMemoryVault() {
  const records = new Map();
  return {
    async read(bucket, id) { return records.get(`${bucket}:${id}`) || null; },
    async write(bucket, id, value) { records.set(`${bucket}:${id}`, structuredClone(value)); },
    async list(bucket) {
      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${bucket}:`))
        .map(([, value]) => structuredClone(value));
    },
    async remove(bucket, id) { return records.delete(`${bucket}:${id}`); },
    async clearAccount(accountId) {
      for (const [key, value] of records) {
        if (key.endsWith(`:${accountId}`) || value?.accountId === accountId) records.delete(key);
      }
    },
  };
}

async function saveVerifiedAccount(vault, accountId = 'seller-01') {
  await vault.write('accounts', accountId, {
    accountId, displayName: 'Alice', enabled: true, verifiedAt: 1,
  });
}

test('sync checkpoints each page and does not duplicate an existing message', async () => {
  const vault = createMemoryVault();
  let conversationPage = 0;
  const service = createInquirySyncService({ vault, now: () => 10000, client: {
    async queryConversations() {
      conversationPage += 1;
      return conversationPage === 1
        ? { items: [{ conversationId: 'conv-1', latestMessageTime: 20 }], hasMore: true, nextTimestamp: '20' }
        : { items: [], hasMore: false, nextTimestamp: null };
    },
    async queryMessages() {
      return { items: [{ messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
        direction: 'buyer', content: 'Hello' }], hasMore: false, nextTimestamp: null };
    },
  } });
  await saveVerifiedAccount(vault);
  await service.syncAccount({}, 'seller-01');
  await service.syncAccount({}, 'seller-01');
  const saved = await vault.read('conversations', 'conv-1');
  assert.deepEqual(saved.messages.map((item) => item.messageId), ['m-1']);
  assert.equal(saved.metrics.unanswered, true);
  assert.ok(await vault.read('cursors', 'seller-01'));
});

test('sync preserves the first message and records a content conflict', () => {
  const existing = { messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
    direction: 'buyer', content: 'Original' };
  const incoming = { ...existing, content: 'Changed' };
  const merged = mergeMessages([existing], [incoming]);
  assert.equal(merged.messages[0].content, 'Original');
  assert.deepEqual(merged.conflicts, [{ messageId: 'm-1', reason: 'content_mismatch' }]);
});

test('merge keeps distinct messages without provider IDs and surfaces data-quality warnings', () => {
  const first = { conversationId: 'conv-1', sendTime: 10, senderAccountId: 'buyer-01',
    direction: 'buyer', content: 'First message' };
  const second = { conversationId: 'conv-1', sendTime: 10, senderAccountId: 'buyer-01',
    direction: 'buyer', content: 'Second message' };

  const merged = mergeMessages([], [first, second]);

  assert.deepEqual(merged.messages.map((item) => item.content), ['First message', 'Second message']);
  assert.equal(merged.warnings.length, 2);
  assert.deepEqual(merged.warnings.map((item) => item.reason), ['missing_message_id', 'missing_message_id']);
  assert.ok(merged.warnings.every((item) => item.messageKey.startsWith('temporary:conv-1:10:buyer-01:')));
});

test('sync refuses disabled and unverified accounts before a client read', async () => {
  const vault = createMemoryVault();
  let reads = 0;
  const service = createInquirySyncService({ vault, client: {
    async queryConversations() { reads += 1; return { items: [], hasMore: false }; },
  } });
  await vault.write('accounts', 'disabled', { accountId: 'disabled', enabled: false, verifiedAt: 1 });
  await vault.write('accounts', 'unverified', { accountId: 'unverified', enabled: true, verifiedAt: null });

  await assert.rejects(() => service.syncAccount({}, 'disabled'), /disabled/);
  await assert.rejects(() => service.syncAccount({}, 'unverified'), /verified/);
  assert.equal(reads, 0);
});

test('sync pauses before the next conversation page when the client closes', async () => {
  const vault = createMemoryVault();
  let conversationReads = 0;
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      conversationReads += 1;
      return { items: [], hasMore: true, nextTimestamp: 'next' };
    },
  } });
  await saveVerifiedAccount(vault);

  let checks = 0;
  const result = await service.syncAccount({}, 'seller-01', { shouldContinue: () => {
    checks += 1;
    return checks === 1;
  } });

  assert.equal(result.status, 'paused');
  assert.equal(conversationReads, 1);
  assert.deepEqual(await vault.read('cursors', 'seller-01'), {
    status: 'paused', code: 'client_closed', lastSuccessfulAt: 100, nextTimestamp: 'next',
  });
});

test('sync resumes an interrupted message page before reading the conversation list again', async () => {
  const vault = createMemoryVault();
  const calls = [];
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      calls.push('conversations');
      return { items: [], hasMore: false, nextTimestamp: null };
    },
    async queryMessages(_config, input) {
      calls.push(`messages:${input.limitTimestamp}`);
      return { items: [{ messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
        direction: 'seller', content: 'Changed' }], hasMore: false, nextTimestamp: null };
    },
  } });
  await saveVerifiedAccount(vault);
  await vault.write('conversations', 'conv-1', {
    conversationId: 'conv-1', accountId: 'seller-01', buyerAccountId: 'buyer-01',
    buyerDisplayName: 'Buyer', latestMessageTime: 10,
    messages: [{ messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
      direction: 'buyer', content: 'Original' }],
    metrics: {}, syncState: { status: 'syncing', nextTimestamp: '10' },
    conflicts: [{ messageId: 'm-0', reason: 'content_mismatch' }],
  });

  await service.syncAccount({}, 'seller-01');

  const saved = await vault.read('conversations', 'conv-1');
  assert.deepEqual(calls, ['messages:10', 'conversations']);
  assert.equal(saved.messages[0].direction, 'buyer');
  assert.deepEqual(saved.conflicts, [
    { messageId: 'm-0', reason: 'content_mismatch' },
    { messageId: 'm-1', reason: 'content_mismatch' },
  ]);
  assert.equal(saved.syncState.status, 'complete');
});

test('sync checks a closed client before the first message request', async () => {
  const vault = createMemoryVault();
  let messageReads = 0;
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      return { items: [{ conversationId: 'conv-1', latestMessageTime: 20 }], hasMore: false, nextTimestamp: null };
    },
    async queryMessages() { messageReads += 1; return { items: [], hasMore: false, nextTimestamp: null }; },
  } });
  await saveVerifiedAccount(vault);
  let checks = 0;

  const result = await service.syncAccount({}, 'seller-01', { shouldContinue: () => {
    checks += 1;
    return checks === 1;
  } });

  assert.equal(result.status, 'paused');
  assert.equal(messageReads, 0);
  assert.deepEqual(await vault.read('cursors', 'seller-01'), {
    status: 'paused', code: 'client_closed', lastSuccessfulAt: 100,
  });
});

test('sync checks a closed client between conversations returned in one page', async () => {
  const vault = createMemoryVault();
  const messageReads = [];
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      return { items: [
        { conversationId: 'conv-1', latestMessageTime: 20 },
        { conversationId: 'conv-2', latestMessageTime: 19 },
      ], hasMore: false, nextTimestamp: null };
    },
    async queryMessages(_config, input) {
      messageReads.push(input.conversationId);
      return { items: [], hasMore: false, nextTimestamp: null };
    },
  } });
  await saveVerifiedAccount(vault);
  let checks = 0;

  const result = await service.syncAccount({}, 'seller-01', { shouldContinue: () => {
    checks += 1;
    return checks < 3;
  } });

  assert.equal(result.status, 'paused');
  assert.deepEqual(messageReads, ['conv-1']);
  assert.deepEqual(await vault.read('cursors', 'seller-01'), {
    status: 'paused', code: 'client_closed', lastSuccessfulAt: 100,
  });
});

test('sync checkpoints each message page and never persists a client error body', async () => {
  const vault = createMemoryVault();
  let messageReads = 0;
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      return { items: [{ conversationId: 'conv-1', latestMessageTime: 20 }], hasMore: false, nextTimestamp: null };
    },
    async queryMessages() {
      messageReads += 1;
      if (messageReads === 1) {
        return { items: [{ messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
          direction: 'buyer', content: 'Hello' }], hasMore: true, nextTimestamp: '10' };
      }
      const error = new Error('server returned secret error body');
      error.code = 'rate_limited';
      throw error;
    },
  } });
  await saveVerifiedAccount(vault);

  await assert.rejects(() => service.syncAccount({}, 'seller-01'), /server returned secret error body/);
  assert.equal((await vault.read('conversations', 'conv-1')).messages.length, 1);
  assert.deepEqual(await vault.read('cursors', 'seller-01'), {
    status: 'paused', code: 'rate_limited', lastSuccessfulAt: 100,
  });
});

test('sync replaces an unsafe client error code before checkpointing it', async () => {
  const vault = createMemoryVault();
  const service = createInquirySyncService({ vault, now: () => 100, client: {
    async queryConversations() {
      const error = new Error('sensitive response body');
      error.code = 'app_secret_should_not_be_saved';
      throw error;
    },
  } });
  await saveVerifiedAccount(vault);

  await assert.rejects(() => service.syncAccount({}, 'seller-01'), /sensitive response body/);
  assert.deepEqual(await vault.read('cursors', 'seller-01'), {
    status: 'paused', code: 'sync_failed', lastSuccessfulAt: 100,
  });
});

test('staged acceptance maxConversations limits only the fetched conversations', async () => {
  const vault = createMemoryVault();
  const requested = [];
  const service = createInquirySyncService({ vault, client: {
    async queryConversations(_config, input) {
      requested.push(input.count);
      return { items: [
        { conversationId: 'conv-1', latestMessageTime: 20 },
        { conversationId: 'conv-2', latestMessageTime: 19 },
      ], hasMore: false, nextTimestamp: null };
    },
    async queryMessages(_config, input) {
      return { items: [{ messageId: `message-${input.conversationId}`, conversationId: input.conversationId,
        sendTime: 10, direction: 'buyer', content: 'Hello' }], hasMore: false, nextTimestamp: null };
    },
  } });
  await saveVerifiedAccount(vault);

  await service.syncAccount({}, 'seller-01', { maxConversations: 1 });

  assert.deepEqual(requested, [1]);
  assert.ok(await vault.read('conversations', 'conv-1'));
  assert.equal(await vault.read('conversations', 'conv-2'), null);
});

test('sync reserves maxConversations for the one-conversation staged acceptance read', async () => {
  const vault = createMemoryVault();
  const service = createInquirySyncService({ vault, client: {
    async queryConversations() { throw new Error('client should not run'); },
  } });
  await saveVerifiedAccount(vault);

  await assert.rejects(() => service.syncAccount({}, 'seller-01', { maxConversations: 2 }), /must be 1/);
});

test('account and conversation helpers normalize storage and scopes', async () => {
  const vault = createMemoryVault();
  const service = createInquirySyncService({ vault, client: {
    async probeInquiryCapability() { return { ok: true, accountId: 'seller-01' }; },
  } });

  await service.saveAccount({ accountId: 'seller-01', displayName: ' Alice ', enabled: true, verifiedAt: 7 });
  await vault.write('conversations', 'conv-1', { conversationId: 'conv-1', accountId: 'seller-01', messages: [] });
  await vault.write('conversations', 'conv-2', { conversationId: 'conv-2', accountId: 'seller-02', messages: [] });

  assert.deepEqual(await service.listAccounts(), [{ accountId: 'seller-01', displayName: 'Alice', enabled: true, verifiedAt: 7 }]);
  assert.deepEqual(await service.listConversations({ accountId: 'seller-01' }), [{ conversationId: 'conv-1', accountId: 'seller-01', messages: [] }]);
  assert.equal((await service.getConversation('conv-1')).accountId, 'seller-01');
  await service.removeAccount('seller-01', { clearData: true });
  assert.equal(await service.getConversation('conv-1'), null);
});
