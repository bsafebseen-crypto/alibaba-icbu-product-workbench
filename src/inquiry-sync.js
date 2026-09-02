import crypto from 'node:crypto';
import { calculateConversationMetrics } from './inquiry-metrics.js';

function requiredId(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeAccount(account = {}) {
  const accountId = requiredId(account.accountId, 'accountId');
  return {
    accountId,
    displayName: String(account.displayName ?? '').trim(),
    enabled: account.enabled !== false,
    verifiedAt: account.verifiedAt ?? null,
  };
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function messageIdentity(item) {
  const messageId = String(item.messageId ?? '').trim();
  if (messageId) return { key: `id:${messageId}` };
  const conversationId = String(item.conversationId ?? '').trim();
  const sendTime = String(item.sendTime ?? '');
  const sender = String(item.senderAccountId ?? item.direction ?? '').trim();
  const contentHash = crypto.createHash('sha256').update(String(item.content ?? '')).digest('hex');
  const messageKey = `temporary:${conversationId}:${sendTime}:${sender}:${contentHash}`;
  return { key: messageKey, warning: { messageKey, reason: 'missing_message_id' } };
}

function errorCode(error) {
  const value = String(error?.code || 'sync_failed');
  return new Set([
    'api_error', 'http_error', 'invalid_account', 'malformed_response',
    'permission_denied', 'rate_limited', 'signature_error',
  ]).has(value) ? value : 'sync_failed';
}

function currentTime(now) {
  const value = Number(now());
  if (!Number.isFinite(value)) throw new Error('sync clock is invalid');
  return value;
}

function isVerified(account) {
  return account.verifiedAt !== null && account.verifiedAt !== undefined && account.verifiedAt !== '';
}

function appendConflicts(existing, additions) {
  const seen = new Set();
  return [...existing, ...additions].filter((conflict) => {
    const key = `${conflict.messageId}:${conflict.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendWarnings(existing, additions) {
  const seen = new Set();
  return [...existing, ...additions].filter((warning) => {
    const key = `${warning.messageKey}:${warning.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesConversation(conversation, filters = {}) {
  if (filters.accountId && conversation.accountId !== filters.accountId) return false;
  if (filters.unanswered !== undefined) {
    const expected = filters.unanswered === true || filters.unanswered === 'true';
    if (conversation.metrics?.unanswered !== expected) return false;
  }
  const latest = Number(conversation.latestMessageTime);
  const from = filters.dateFrom ?? filters.from;
  const to = filters.dateTo ?? filters.to;
  if (from !== undefined && from !== '' && (!Number.isFinite(latest) || latest < Number(from))) return false;
  if (to !== undefined && to !== '' && (!Number.isFinite(latest) || latest > Number(to))) return false;
  return true;
}

export function mergeMessages(existing, incoming) {
  const byId = new Map();
  const conflicts = [];
  const warnings = [];
  for (const item of existing) {
    const identity = messageIdentity(item);
    byId.set(identity.key, structuredClone(item));
    if (identity.warning) warnings.push(identity.warning);
  }
  for (const item of incoming) {
    const identity = messageIdentity(item);
    const previous = byId.get(identity.key);
    if (!previous) byId.set(identity.key, structuredClone(item));
    else if (stableHash(previous) !== stableHash(item)) {
      conflicts.push({ messageId: item.messageId || identity.key, reason: 'content_mismatch' });
    }
    if (identity.warning) warnings.push(identity.warning);
  }
  return {
    messages: [...byId.values()].sort((a, b) => a.sendTime - b.sendTime
      || String(a.messageId).localeCompare(String(b.messageId))),
    conflicts,
    warnings: appendWarnings([], warnings),
  };
}

export function createInquirySyncService({ vault, client, now = Date.now } = {}) {
  if (!vault || !client) throw new Error('vault and client are required');

  async function checkpoint(accountId, value) {
    await vault.write('cursors', accountId, value);
  }

  async function pause(accountId, code, extras = {}) {
    const value = { status: 'paused', code, lastSuccessfulAt: currentTime(now), ...extras };
    await checkpoint(accountId, value);
    return value;
  }

  async function shouldMakeNextRequest(shouldContinue, accountId, extras) {
    if (!shouldContinue || await shouldContinue()) return null;
    return pause(accountId, 'client_closed', extras);
  }

  async function storeMessagePage(account, conversation, messages, nextTimestamp, status = 'syncing') {
    const existing = await vault.read('conversations', conversation.conversationId);
    const merged = mergeMessages(existing?.messages || [], messages);
    const stored = {
      conversationId: conversation.conversationId,
      accountId: account.accountId,
      buyerAccountId: conversation.buyerAccountId ?? existing?.buyerAccountId ?? '',
      buyerDisplayName: conversation.buyerDisplayName ?? existing?.buyerDisplayName ?? '',
      latestMessageTime: conversation.latestMessageTime ?? existing?.latestMessageTime ?? null,
      messages: merged.messages,
      metrics: calculateConversationMetrics(merged.messages, currentTime(now)),
      syncState: { status, lastSuccessfulAt: currentTime(now), ...(nextTimestamp ? { nextTimestamp } : {}) },
      conflicts: appendConflicts(existing?.conflicts || [], merged.conflicts),
      dataQualityWarnings: appendWarnings(existing?.dataQualityWarnings || [], merged.warnings),
    };
    await vault.write('conversations', stored.conversationId, stored);
    return stored;
  }

  async function synchronizeConversation(config, account, conversation, shouldContinue, startingTimestamp = null) {
    let nextTimestamp = startingTimestamp;
    do {
      const paused = await shouldMakeNextRequest(shouldContinue, account.accountId, {});
      if (paused) return paused;
      let page;
      try {
        page = await client.queryMessages(config, {
          conversationId: conversation.conversationId,
          selfAccountId: account.accountId,
          count: 50,
          ...(nextTimestamp ? { limitTimestamp: nextTimestamp } : {}),
        });
      } catch (error) {
        await pause(account.accountId, errorCode(error));
        throw error;
      }

      await storeMessagePage(account, conversation, page.items || [], page.nextTimestamp,
        page.hasMore ? 'syncing' : 'complete');
      nextTimestamp = page.hasMore ? page.nextTimestamp : null;
    } while (nextTimestamp);
    return null;
  }

  async function probe(config, account) {
    const normalized = normalizeAccount(typeof account === 'string' ? { accountId: account } : account);
    return client.probeInquiryCapability(config, normalized.accountId);
  }

  async function saveAccount(account) {
    const normalized = normalizeAccount(account);
    await vault.write('accounts', normalized.accountId, normalized);
    return normalized;
  }

  async function listAccounts() {
    const accounts = await vault.list('accounts');
    return accounts.map(normalizeAccount).sort((left, right) => left.accountId.localeCompare(right.accountId));
  }

  async function removeAccount(accountId, { clearData = false } = {}) {
    const normalizedId = requiredId(accountId, 'accountId');
    if (clearData) {
      await vault.clearAccount(normalizedId);
      return true;
    }
    return vault.remove('accounts', normalizedId);
  }

  async function syncAccount(config, accountId, { maxConversations, shouldContinue } = {}) {
    const normalizedId = requiredId(accountId, 'accountId');
    const accountRecord = await vault.read('accounts', normalizedId);
    if (!accountRecord) throw new Error('account was not found');
    const account = normalizeAccount(accountRecord);
    if (!account.enabled) throw new Error('account is disabled');
    if (!isVerified(account)) throw new Error('account must be verified before sync');
    if (maxConversations !== undefined && maxConversations !== 1) {
      throw new Error('maxConversations must be 1 for staged acceptance');
    }

    const priorCursor = await vault.read('cursors', account.accountId);
    const interruptedConversations = (await vault.list('conversations')).filter((conversation) => (
      conversation.accountId === account.accountId
      && conversation.syncState?.status === 'syncing'
      && conversation.syncState.nextTimestamp
    ));
    for (const conversation of interruptedConversations) {
      const paused = await synchronizeConversation(
        config, account, conversation, shouldContinue, conversation.syncState.nextTimestamp,
      );
      if (paused) return { status: 'paused', synchronized: 0 };
    }
    let nextTimestamp = priorCursor?.status === 'paused' ? priorCursor.nextTimestamp : null;
    let synchronized = 0;
    do {
      const paused = await shouldMakeNextRequest(shouldContinue, account.accountId,
        nextTimestamp ? { nextTimestamp } : {});
      if (paused) return { status: 'paused', synchronized };
      let page;
      try {
        page = await client.queryConversations(config, {
          sellerAccountId: account.accountId,
          ...(maxConversations === undefined ? {} : { count: maxConversations }),
          ...(nextTimestamp ? { limitTimestamp: nextTimestamp } : {}),
        });
      } catch (error) {
        await pause(account.accountId, errorCode(error), nextTimestamp ? { nextTimestamp } : {});
        throw error;
      }

      const items = (page.items || []).slice(0, maxConversations === undefined ? undefined : maxConversations - synchronized);
      for (const conversation of items) {
        const paused = await synchronizeConversation(config, account, conversation, shouldContinue);
        if (paused) return { status: 'paused', synchronized };
        synchronized += 1;
        if (maxConversations !== undefined && synchronized >= maxConversations) break;
      }

      nextTimestamp = page.hasMore && (maxConversations === undefined || synchronized < maxConversations)
        ? page.nextTimestamp : null;
      const complete = !nextTimestamp;
      await checkpoint(account.accountId, {
        status: complete ? 'complete' : 'syncing',
        lastSuccessfulAt: currentTime(now),
        ...(nextTimestamp ? { nextTimestamp } : {}),
      });
    } while (nextTimestamp);

    return { status: 'complete', synchronized };
  }

  async function listConversations(filters = {}) {
    return (await vault.list('conversations'))
      .filter((conversation) => matchesConversation(conversation, filters))
      .sort((left, right) => Number(right.latestMessageTime) - Number(left.latestMessageTime)
        || left.conversationId.localeCompare(right.conversationId));
  }

  async function getConversation(conversationId) {
    return vault.read('conversations', requiredId(conversationId, 'conversationId'));
  }

  return {
    probe,
    saveAccount,
    listAccounts,
    removeAccount,
    syncAccount,
    listConversations,
    getConversation,
  };
}
