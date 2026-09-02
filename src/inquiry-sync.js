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
  const byId = new Map(existing.map((item) => [item.messageId, structuredClone(item)]));
  const conflicts = [];
  for (const item of incoming) {
    const previous = byId.get(item.messageId);
    if (!previous) byId.set(item.messageId, structuredClone(item));
    else if (stableHash(previous) !== stableHash(item)) {
      conflicts.push({ messageId: item.messageId, reason: 'content_mismatch' });
    }
  }
  return {
    messages: [...byId.values()].sort((a, b) => a.sendTime - b.sendTime
      || String(a.messageId).localeCompare(String(b.messageId))),
    conflicts,
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
    };
    await vault.write('conversations', stored.conversationId, stored);
    return stored;
  }

  async function synchronizeConversation(config, account, conversation, shouldContinue) {
    let nextTimestamp;
    do {
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
      if (nextTimestamp) {
        const paused = await shouldMakeNextRequest(shouldContinue, account.accountId, {});
        if (paused) return paused;
      }
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
    let nextTimestamp = priorCursor?.status === 'paused' ? priorCursor.nextTimestamp : null;
    let synchronized = 0;
    do {
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
      if (nextTimestamp) {
        const paused = await shouldMakeNextRequest(shouldContinue, account.accountId, { nextTimestamp });
        if (paused) return { status: 'paused', synchronized };
      }
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
