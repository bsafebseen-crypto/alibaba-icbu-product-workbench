# Inquiry Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, read-only Alibaba inquiry workspace that encrypts chat data, computes factual conversation metrics, and runs user-confirmed DeepSeek reviews with evidence references.

**Architecture:** Add six focused server modules for the TOP read client, encrypted vault, synchronization, metrics, review generation, and route handling. Add one browser module and one new navigation page; Alibaba credentials remain transient, while chat data and the DeepSeek Key are encrypted under a password-derived key in `data/inquiry-review/`.

**Tech Stack:** Node.js 20+, native ESM, Node HTTP server, Node `crypto` and `fs/promises`, browser ES modules, OpenAI-compatible DeepSeek Chat Completions API, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-inquiry-review-design.md`

## Global Constraints

- The service listens only on `127.0.0.1` and the existing port remains `54025`.
- Alibaba inquiry access is read-only and the only allowed methods are `alibaba.interaction.im.conversation.list.query` and `alibaba.interaction.im.message.list.query`.
- Do not add Alibaba message-send, customer-update, product-update, publish, unpublish, or browser-scraping behavior.
- Alibaba App Secret and access tokens remain transient and are never written by this subsystem.
- Chat bodies, contact details, review results, vault passwords, derived keys, and DeepSeek API keys must not enter Git, normal logs, error responses, or unencrypted files.
- DeepSeek is called only after the user reviews the redacted payload and explicitly confirms one conversation.
- The generated reply is display-only and is never sent to Alibaba.
- Retention is exactly 90 days, based on message send time.
- Use Node built-ins; do not add a framework, database, native module, or cryptography dependency.
- Every implementation task starts with a failing focused test, then adds the minimum production code, then runs the focused tests.
- Automated tests use fictional IDs and mock HTTP responses only.

## File Structure

Create these focused files:

- `src/inquiry-client.js`: sign and normalize the two allowed Alibaba TOP read APIs.
- `src/inquiry-vault.js`: password-derived key lifecycle, AES-256-GCM records, atomic writes, listing, deletion, password changes, and retention cleanup.
- `src/inquiry-metrics.js`: pure deterministic calculations from normalized messages.
- `src/inquiry-sync.js`: account validation, pagination, cursor checkpoints, message de-duplication, and conflict handling.
- `src/inquiry-review.js`: redaction, DeepSeek prompt construction, response validation, evidence validation, and Token accounting.
- `src/inquiry-routes.js`: inquiry-only request authentication, route parsing, safe response shaping, and orchestration.
- `public/inquiry-review.js`: inquiry page state, rendering, forms, filters, confirmations, and API calls.
- `tests/inquiry-client.test.js`, `tests/inquiry-vault.test.js`, `tests/inquiry-metrics.test.js`, `tests/inquiry-sync.test.js`, `tests/inquiry-review.test.js`, `tests/inquiry-routes.test.js`, `tests/inquiry-review-ui.test.js`: focused tests.

Modify these existing files:

- `src/ai-client.js`: export the existing OpenAI-compatible completion primitive for the review module without changing current callers.
- `src/server.js`: create the inquiry dependencies, delegate `/api/inquiry/*`, and serve the new browser module.
- `public/index.html`: add the navigation entry and inquiry page markup.
- `public/app.js`: initialize the inquiry browser module and expose the current transient Alibaba configuration to it.
- `public/styles.css`: add scoped three-column inquiry page styles and responsive behavior.
- `.gitignore`: explicitly ignore `data/inquiry-review/`.
- `tests/server.test.js`: verify server integration, static delivery, navigation, and non-regression.
- `README.md` and `WORK_MACHINE_SETUP.md`: document setup, security, retention, Token usage, and the staged permission probe.

---

### Task 1: Read-only Alibaba inquiry client

**Files:**
- Create: `src/inquiry-client.js`
- Create: `tests/inquiry-client.test.js`

**Interfaces:**
- Consumes: `signAlibabaParams(params, appSecret)` from `src/alibaba-client.js`.
- Produces: `queryConversations(config, input, fetchImpl, timestamp) -> Promise<{items,nextTimestamp,hasMore,requestId}>`.
- Produces: `queryMessages(config, input, fetchImpl, timestamp) -> Promise<{items,nextTimestamp,hasMore,requestId}>`.
- Produces: `probeInquiryCapability(config, sellerAccountId, fetchImpl, timestamp) -> Promise<{ok,empty,accountId}>`.
- Normalized conversation: `{conversationId,latestMessageTime,buyerAccountId,buyerDisplayName,lastMessagePreview}`.
- Normalized message: `{messageId,conversationId,sendTime,senderAccountId,receiverAccountId,direction,content,messageType}`.

- [ ] **Step 1: Write failing signing, allowlist, normalization, and error tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeInquiryCapability,
  queryConversations,
  queryMessages,
} from '../src/inquiry-client.js';

const config = {
  gatewayUrl: 'https://eco.example.com/router/rest',
  appKey: 'fictional-key',
  appSecret: 'fictional-secret',
};

test('queryConversations calls only the conversation read method without session', async () => {
  let request;
  const result = await queryConversations(config, {
    sellerAccountId: 'seller-01', count: 1, limitTimestamp: '1700000000000',
  }, async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, async json() {
      return { alibaba_interaction_im_conversation_list_query_response: {
        request_id: 'req-1', result: {
          conversation_list: [{ conversation_id: 'conv-1', latest_message_time: 1700000001000 }],
          has_more: true, next_time_stamp: 1700000001000,
        },
      } };
    } };
  }, 1700000002000);
  assert.equal(request.body.method, 'alibaba.interaction.im.conversation.list.query');
  assert.equal('session' in request.body, false);
  assert.equal(request.body.seller_account_id, 'seller-01');
  assert.equal(result.items[0].conversationId, 'conv-1');
  assert.equal(result.hasMore, true);
});

test('queryMessages fixes direction relative to selfAccountId', async () => {
  const result = await queryMessages(config, {
    conversationId: 'conv-1', selfAccountId: 'seller-01', count: 50,
  }, async () => ({ ok: true, async json() {
    return { alibaba_interaction_im_message_list_query_response: { result: {
      message_list: [{ message_id: 'm-1', conversation_id: 'conv-1', send_time: 10,
        sender_account_id: 'buyer-01', receiver_account_id: 'seller-01',
        content: 'Need 500 pieces', message_type: 'TEXT' }], has_more: false,
    } } };
  } }), 20);
  assert.equal(result.items[0].direction, 'buyer');
  assert.equal(result.items[0].content, 'Need 500 pieces');
});

test('probeInquiryCapability classifies permission errors without leaking secrets', async () => {
  await assert.rejects(() => probeInquiryCapability(config, 'seller-01', async () => ({
    ok: true,
    async json() { return { error_response: { code: 27, sub_code: 'isp.permission-denied', msg: 'No permission' } }; },
  }), 20), (error) => error.code === 'permission_denied' && !error.message.includes('fictional-secret'));
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test tests/inquiry-client.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/inquiry-client.js`.

- [ ] **Step 3: Implement a private allowlisted TOP caller and public normalizers**

```js
import { signAlibabaParams } from './alibaba-client.js';

const METHODS = Object.freeze({
  conversations: 'alibaba.interaction.im.conversation.list.query',
  messages: 'alibaba.interaction.im.message.list.query',
});

function requireConfig(config = {}) {
  const gatewayUrl = String(config.gatewayUrl || 'https://eco.taobao.com/router/rest').trim();
  const appKey = String(config.appKey || '').trim();
  const appSecret = String(config.appSecret || '').trim();
  if (!gatewayUrl.startsWith('https://')) throw new Error('询盘网关必须使用 HTTPS');
  if (!appKey || !appSecret) throw new Error('请填写 App Key 和 App Secret');
  return { gatewayUrl, appKey, appSecret };
}

async function callReadMethod(config, method, apiParams, fetchImpl, timestamp) {
  if (!Object.values(METHODS).includes(method)) throw new Error('询盘接口不在只读允许列表');
  const value = requireConfig(config);
  const params = {
    app_key: value.appKey, format: 'json', method, sign_method: 'sha256',
    timestamp: String(timestamp), v: '2.0', ...apiParams,
  };
  params.sign = signAlibabaParams(params, value.appSecret);
  const response = await fetchImpl(value.gatewayUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error_response) throw classifyInquiryError(body.error_response, response.status);
  return body;
}

function classifyInquiryError(payload = {}, httpStatus = 200) {
  const source = `${payload.code || ''} ${payload.sub_code || ''} ${payload.msg || ''}`.toLowerCase();
  let code = 'api_error';
  if (/permission|unauthor|access.denied/.test(source)) code = 'permission_denied';
  else if (/sign|signature/.test(source)) code = 'signature_error';
  else if (/flow|limit|thrott|frequency/.test(source) || httpStatus === 429) code = 'rate_limited';
  else if (/account|seller/.test(source) && /invalid|not.exist|illegal/.test(source)) code = 'invalid_account';
  else if (httpStatus >= 400) code = 'http_error';
  const error = new Error(code === 'permission_denied' ? '当前阿里应用没有询盘读取权限' : '阿里询盘接口请求失败');
  error.code = code;
  error.status = httpStatus;
  return error;
}
```

Add strict input validation: IDs are non-empty strings of at most 128 characters, `count` is an integer from 1 through 50, timestamps are digit strings, and `forward` is boolean. Map permission, signing, rate-limit, invalid-account, HTTP, and malformed-response failures to stable codes without copying request bodies or secrets into messages.

- [ ] **Step 4: Run client tests**

Run: `node --test tests/inquiry-client.test.js`

Expected: all inquiry client tests PASS.

- [ ] **Step 5: Commit the client**

```powershell
git add src/inquiry-client.js tests/inquiry-client.test.js
git commit -m "feat: add read-only inquiry client"
```

### Task 2: Encrypted local inquiry vault

**Files:**
- Create: `src/inquiry-vault.js`
- Create: `tests/inquiry-vault.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `createInquiryVaultStore(rootDir, options = {})`.
- Store methods: `status()`, `create(password)`, `unlock(password)`, `lock()`, `changePassword(oldPassword,newPassword)`, `read(bucket,id)`, `write(bucket,id,value)`, `list(bucket)`, `remove(bucket,id)`, `clearAccount(accountId)`, `clearAll()`, `prune(now)`.
- Allowed buckets: `settings`, `accounts`, `conversations`, `reviews`, `cursors`.
- `status() -> {exists,locked,version}` contains no record names or sensitive values.

- [ ] **Step 1: Write failing vault lifecycle and ciphertext tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
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
  vault.lock();
  await assert.rejects(() => vault.unlock('wrong password value'), /资料库密码错误/);
});

test('prune removes messages older than exactly 90 days and dependent empty reviews', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'inquiry-vault-'));
  const vault = createInquiryVaultStore(root);
  await vault.create('retention password');
  await vault.write('conversations', 'conv-1', { accountId: 'seller-01', messages: [
    { messageId: 'old', sendTime: 1 }, { messageId: 'new', sendTime: 90 * 86400000 + 2 },
  ] });
  await vault.prune(180 * 86400000 + 1);
  assert.deepEqual((await vault.read('conversations', 'conv-1')).messages.map((item) => item.messageId), ['new']);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/inquiry-vault.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/inquiry-vault.js`.

- [ ] **Step 3: Implement scrypt, AES-256-GCM, hashed names, and atomic records**

```js
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BUCKETS = new Set(['settings', 'accounts', 'conversations', 'reviews', 'cursors']);

function deriveKey(password, salt) {
  if (String(password).length < 12) throw new Error('资料库密码至少需要 12 个字符');
  return crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function seal(key, value) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { version: VERSION, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function recordName(id) {
  return `${crypto.createHash('sha256').update(String(id), 'utf8').digest('hex')}.enc`;
}
```

The vault metadata file contains `version`, `salt`, KDF parameters, and an encrypted constant check value. `write()` writes a uniquely named temporary file in the target directory and renames it over the record. `changePassword()` writes a complete sibling vault, verifies every new record, then swaps directories; any failure removes only the sibling directory and leaves the old vault intact. `lock()` calls `key.fill(0)` before clearing the reference. `clearAll()` removes every bucket record but preserves the vault metadata and current unlocked key. Never include record IDs in filenames.

- [ ] **Step 4: Add explicit ignore rule and portability assertion**

Append this line to `.gitignore`:

```gitignore
data/inquiry-review/
```

Add a test asserting the rule exists and no vault fixture is located under the repository.

- [ ] **Step 5: Run vault and portability tests**

Run: `node --test tests/inquiry-vault.test.js tests/portability.test.js`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit the vault**

```powershell
git add .gitignore src/inquiry-vault.js tests/inquiry-vault.test.js tests/portability.test.js
git commit -m "feat: add encrypted inquiry vault"
```

### Task 3: Deterministic inquiry metrics

**Files:**
- Create: `src/inquiry-metrics.js`
- Create: `tests/inquiry-metrics.test.js`

**Interfaces:**
- Produces: `calculateConversationMetrics(messages, now) -> {firstResponseMs,unanswered,unansweredMs,buyerMessageCount,sellerMessageCount,durationMs,lastActiveTime}`.
- Input messages use the normalized Task 1 message shape and are sorted internally by `sendTime`, then `messageId`.

- [ ] **Step 1: Write failing metric tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConversationMetrics } from '../src/inquiry-metrics.js';

test('metrics calculate first response and current unanswered time from facts', () => {
  const result = calculateConversationMetrics([
    { messageId: 'm3', sendTime: 5000, direction: 'buyer' },
    { messageId: 'm1', sendTime: 1000, direction: 'buyer' },
    { messageId: 'm2', sendTime: 3000, direction: 'seller' },
  ], 9000);
  assert.deepEqual(result, {
    firstResponseMs: 2000, unanswered: true, unansweredMs: 4000,
    buyerMessageCount: 2, sellerMessageCount: 1, durationMs: 4000, lastActiveTime: 5000,
  });
});

test('metrics use null when no buyer message has received a seller response', () => {
  const result = calculateConversationMetrics([
    { messageId: 'm1', sendTime: 1000, direction: 'buyer' },
  ], 2000);
  assert.equal(result.firstResponseMs, null);
  assert.equal(result.unanswered, true);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/inquiry-metrics.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/inquiry-metrics.js`.

- [ ] **Step 3: Implement the pure calculation**

```js
export function calculateConversationMetrics(messages, now = Date.now()) {
  const ordered = [...messages].sort((a, b) => a.sendTime - b.sendTime
    || String(a.messageId).localeCompare(String(b.messageId)));
  const firstBuyerIndex = ordered.findIndex((item) => item.direction === 'buyer');
  const firstSellerAfterBuyer = firstBuyerIndex < 0 ? undefined
    : ordered.slice(firstBuyerIndex + 1).find((item) => item.direction === 'seller');
  const last = ordered.at(-1);
  return {
    firstResponseMs: firstSellerAfterBuyer
      ? firstSellerAfterBuyer.sendTime - ordered[firstBuyerIndex].sendTime : null,
    unanswered: last?.direction === 'buyer',
    unansweredMs: last?.direction === 'buyer' ? Math.max(0, now - last.sendTime) : null,
    buyerMessageCount: ordered.filter((item) => item.direction === 'buyer').length,
    sellerMessageCount: ordered.filter((item) => item.direction === 'seller').length,
    durationMs: ordered.length > 1 ? last.sendTime - ordered[0].sendTime : 0,
    lastActiveTime: last?.sendTime ?? null,
  };
}
```

Reject messages with an invalid direction or non-finite non-negative `sendTime`; return the all-null/zero shape for an empty array.

- [ ] **Step 4: Run metric tests**

Run: `node --test tests/inquiry-metrics.test.js`

Expected: all metric tests PASS.

- [ ] **Step 5: Commit the metrics**

```powershell
git add src/inquiry-metrics.js tests/inquiry-metrics.test.js
git commit -m "feat: calculate inquiry response metrics"
```

### Task 4: Paginated synchronization and conflict-safe de-duplication

**Files:**
- Create: `src/inquiry-sync.js`
- Create: `tests/inquiry-sync.test.js`

**Interfaces:**
- Consumes: Task 1 `queryConversations` and `queryMessages` through injected `client` methods.
- Consumes: Task 2 vault methods.
- Consumes: Task 3 `calculateConversationMetrics`.
- Produces: `createInquirySyncService({vault,client,now})`.
- Service methods: `probe(config, account)`, `saveAccount(account)`, `listAccounts()`, `removeAccount(accountId,{clearData})`, `syncAccount(config,accountId,{maxConversations,shouldContinue})`, `listConversations(filters)`, `getConversation(conversationId)`.
- Account: `{accountId,displayName,enabled,verifiedAt}`.
- Stored conversation: `{conversationId,accountId,buyerAccountId,buyerDisplayName,latestMessageTime,messages,metrics,syncState,conflicts}`.

- [ ] **Step 1: Write failing resume and de-duplication tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquirySyncService, mergeMessages } from '../src/inquiry-sync.js';

test('sync checkpoints each page and does not duplicate an existing message', async () => {
  const records = new Map();
  const vault = {
    async read(bucket, id) { return records.get(`${bucket}:${id}`) || null; },
    async write(bucket, id, value) { records.set(`${bucket}:${id}`, structuredClone(value)); },
    async list(bucket) { return [...records.entries()].filter(([key]) => key.startsWith(`${bucket}:`)).map(([, value]) => structuredClone(value)); },
  };
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
  await vault.write('accounts', 'seller-01', { accountId: 'seller-01', displayName: 'Alice', enabled: true, verifiedAt: 1 });
  await service.syncAccount({}, 'seller-01');
  await service.syncAccount({}, 'seller-01');
  const saved = await vault.read('conversations', 'conv-1');
  assert.deepEqual(saved.messages.map((item) => item.messageId), ['m-1']);
  assert.equal(saved.metrics.unanswered, true);
  assert.ok(await vault.read('cursors', 'seller-01'));
});

test('sync preserves the first message and records a content conflict', async () => {
  const existing = { messageId: 'm-1', conversationId: 'conv-1', sendTime: 10,
    direction: 'buyer', content: 'Original' };
  const incoming = { ...existing, content: 'Changed' };
  const merged = mergeMessages([existing], [incoming]);
  assert.equal(merged.messages[0].content, 'Original');
  assert.deepEqual(merged.conflicts, [{ messageId: 'm-1', reason: 'content_mismatch' }]);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/inquiry-sync.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/inquiry-sync.js`.

- [ ] **Step 3: Implement normalized account storage, checkpoints, and merge logic**

```js
import crypto from 'node:crypto';
import { calculateConversationMetrics } from './inquiry-metrics.js';

export function mergeMessages(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.messageId, structuredClone(item)]));
  const conflicts = [];
  for (const item of incoming) {
    const previous = byId.get(item.messageId);
    if (!previous) byId.set(item.messageId, structuredClone(item));
    else if (crypto.createHash('sha256').update(JSON.stringify(previous)).digest('hex')
      !== crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex')) {
      conflicts.push({ messageId: item.messageId, reason: 'content_mismatch' });
    }
  }
  return {
    messages: [...byId.values()].sort((a, b) => a.sendTime - b.sendTime
      || a.messageId.localeCompare(b.messageId)),
    conflicts,
  };
}
```

`syncAccount()` refuses unverified or disabled accounts. It stores the conversation page cursor after every successful page and stores each message page before requesting the next page. On a client error it writes `{status:'paused',code,lastSuccessfulAt}` without the raw error or credentials. `maxConversations` is used only by staged acceptance to restrict the first real read to one conversation. Before each next-page request it calls `shouldContinue()`; if false, it checkpoints `{status:'paused',code:'client_closed'}` and returns without starting another network call.

- [ ] **Step 4: Run sync tests**

Run: `node --test tests/inquiry-sync.test.js tests/inquiry-metrics.test.js`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit synchronization**

```powershell
git add src/inquiry-sync.js tests/inquiry-sync.test.js
git commit -m "feat: synchronize inquiry conversations"
```

### Task 5: Redacted and evidence-checked DeepSeek reviews

**Files:**
- Create: `src/inquiry-review.js`
- Create: `tests/inquiry-review.test.js`
- Modify: `src/ai-client.js`
- Modify: `tests/ai-client.test.js`

**Interfaces:**
- Produces from `src/ai-client.js`: `requestAiCompletion(config, body, fetchImpl) -> Promise<{content,usage}>`; existing generation functions continue returning their current shapes.
- Produces: `redactConversation(messages) -> {messages,preview,redactionVersion}`.
- Produces: `reviewConversation(config, conversation, fetchImpl) -> Promise<ReviewRecord>`.
- Review record: `{conversationId,model,createdAt,usage,redactionVersion,result}`.
- Result fields exactly match the approved spec and evidence items use `{messageNumber,time,claim}`.

- [ ] **Step 1: Write failing redaction, evidence, and usage tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactConversation, reviewConversation } from '../src/inquiry-review.js';

const messages = [{
  messageId: 'msg-secret-1', conversationId: 'conv-secret-1', sendTime: 1700000000000,
  senderAccountId: 'buyer-secret', receiverAccountId: 'seller-secret', direction: 'buyer',
  content: 'Email me at buyer@example.com or +86 138 0013 8000 for 500 jackets.', messageType: 'TEXT',
}];

test('redaction removes contact and platform identifiers but keeps business facts', () => {
  const result = redactConversation(messages);
  assert.doesNotMatch(result.preview, /buyer@example|138 0013|msg-secret|conv-secret|buyer-secret|seller-secret/);
  assert.match(result.preview, /500 jackets/);
  assert.match(result.preview, /M1/);
});

test('reviewConversation rejects evidence that references a missing message', async () => {
  await assert.rejects(() => reviewConversation({
    baseUrl: 'https://api.deepseek.example', apiKey: 'deepseek-secret', model: 'deepseek-model',
  }, { conversationId: 'conv-secret-1', messages }, async () => ({ ok: true, async json() {
    return { choices: [{ message: { content: JSON.stringify({
      customerNeeds: ['500 jackets'], buyingStage: { value: '询价', evidence: ['M9'] },
      strengths: [], missedQuestions: [], communicationIssues: [], risks: [],
      nextActions: [], replyDraft: 'Thank you.', evidence: [{ messageNumber: 'M9', time: 1, claim: 'unsupported' }],
    }) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
  } })), /不存在的消息依据/);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/inquiry-review.test.js tests/ai-client.test.js`

Expected: FAIL because `src/inquiry-review.js` and `requestAiCompletion` do not exist.

- [ ] **Step 3: Export the compatible completion primitive without breaking callers**

Change the existing private completion function to return content and usage:

```js
export async function requestAiCompletion(config, body, fetchImpl = fetch) {
  const { baseUrl, apiKey, model } = requireConfig(config);
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `模型接口请求失败（HTTP ${response.status}）`);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回可用内容');
  return { content: content.trim(), usage: {
    promptTokens: Number(payload.usage?.prompt_tokens || 0),
    completionTokens: Number(payload.usage?.completion_tokens || 0),
    totalTokens: Number(payload.usage?.total_tokens || 0),
  } };
}
```

Update `testAiConnection`, `generateProducts`, and `generateSimilarProducts` to destructure `{content}`. Extend existing tests to assert their public return values have not changed.

- [ ] **Step 4: Implement mandatory redaction and strict JSON validation**

```js
import { requestAiCompletion } from './ai-client.js';

const REDACTION_VERSION = 1;

export function redactConversation(messages) {
  const safe = messages.map((message, index) => ({
    messageNumber: `M${index + 1}`,
    time: new Date(message.sendTime).toISOString(),
    speaker: message.direction === 'seller' ? 'Salesperson' : 'Buyer',
    content: String(message.content)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
      .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[CREDENTIAL]'),
  }));
  return { messages: safe, preview: safe.map((item) =>
    `${item.messageNumber} ${item.time} ${item.speaker}: ${item.content}`).join('\n'),
  redactionVersion: REDACTION_VERSION };
}
```

Before redaction, replace every known message, conversation, sender, and receiver ID by exact string match. Require every result field, cap arrays at 20 entries, cap `replyDraft` at 4000 characters, and verify every evidence message number is present in the redacted input. The system prompt states that unsupported conclusions must be `信息不足` and requests JSON only.

- [ ] **Step 5: Run AI and review tests**

Run: `node --test tests/ai-client.test.js tests/inquiry-review.test.js`

Expected: all selected tests PASS and serialized model requests contain no fictional secrets or contact details.

- [ ] **Step 6: Commit the review engine**

```powershell
git add src/ai-client.js src/inquiry-review.js tests/ai-client.test.js tests/inquiry-review.test.js
git commit -m "feat: add evidence-based inquiry reviews"
```

### Task 6: Protected inquiry HTTP routes

**Files:**
- Create: `src/inquiry-routes.js`
- Create: `tests/inquiry-routes.test.js`
- Modify: `src/server.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `createInquiryRouteHandler({rootDir,pageToken,vault,syncService,reviewConversation,testAiConnection})`.
- Produces handler: `handle(request,response,url) -> Promise<boolean>`; returns `false` for non-inquiry paths.
- Bootstrap: `GET /api/inquiry/bootstrap -> {pageToken,vault:{exists,locked,version}}`.
- Protected requests require `X-ICBU-Page-Token` and same-origin `Origin` when that header is present.
- All protected responses pass through a recursive sensitive-key and sensitive-text scrubber.

- [ ] **Step 1: Write failing route security and lifecycle tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createInquiryRouteHandler } from '../src/inquiry-routes.js';

async function invokeHandler(handler, { method, path, headers = {}, body }) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.url = path;
  request.headers = { host: '127.0.0.1:54025', ...headers };
  let status = 200;
  let raw = '';
  const response = {
    writeHead(value) { status = value; },
    end(value = '') { raw += String(value); },
  };
  await handler.handle(request, response, new URL(path, 'http://127.0.0.1:54025'));
  return { status, body: raw ? JSON.parse(raw) : null };
}

test('protected routes reject the wrong page token before reading the vault', async () => {
  let accessed = false;
  const handler = createInquiryRouteHandler({
    pageToken: 'correct-token', vault: { status() { accessed = true; return {}; } },
    syncService: {}, reviewConversation: async () => ({}), testAiConnection: async () => ({}),
  });
  const result = await invokeHandler(handler, {
    method: 'GET', path: '/api/inquiry/state', headers: { 'x-icbu-page-token': 'wrong-token' },
  });
  assert.equal(result.status, 403);
  assert.equal(accessed, false);
});

test('bootstrap returns only the random page token and vault status', async () => {
  const handler = createInquiryRouteHandler({
    pageToken: 'page-token', vault: { status() { return { exists: true, locked: true, version: 1 }; } },
    syncService: {}, reviewConversation: async () => ({}), testAiConnection: async () => ({}),
  });
  const result = await invokeHandler(handler, { method: 'GET', path: '/api/inquiry/bootstrap' });
  assert.deepEqual(result.body, { pageToken: 'page-token', vault: { exists: true, locked: true, version: 1 } });
});
```

The test helper creates mock request/response streams, always uses fictional secrets, and asserts error bodies exclude `apiKey`, `appSecret`, `content`, and the supplied secret values.

- [ ] **Step 2: Run route tests and verify failure**

Run: `node --test tests/inquiry-routes.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/inquiry-routes.js`.

- [ ] **Step 3: Implement route authentication and explicit route table**

```js
function requirePageRequest(request, pageToken) {
  const supplied = String(request.headers['x-icbu-page-token'] || '');
  if (supplied.length !== pageToken.length
    || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(pageToken))) {
    throw Object.assign(new Error('本地页面验证失败'), { status: 403 });
  }
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(String(host || ''))) {
    throw Object.assign(new Error('本地 Host 验证失败'), { status: 403 });
  }
  if (origin && origin !== `http://${host}`) {
    throw Object.assign(new Error('拒绝非同源请求'), { status: 403 });
  }
}
```

Apply the Host, Origin, and `Sec-Fetch-Site` checks to bootstrap as well; bootstrap does not require the page token because it is the endpoint that issues it. Reject `Sec-Fetch-Site: cross-site` before returning the token.

Implement only these routes:

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/inquiry/bootstrap` | Return page token and non-sensitive vault status |
| POST | `/api/inquiry/vault/create` | Create, unlock, and run retention cleanup with `{password}` |
| POST | `/api/inquiry/vault/unlock` | Unlock and run retention cleanup with `{password}` |
| POST | `/api/inquiry/vault/lock` | Zero the in-memory key |
| POST | `/api/inquiry/vault/password` | Change with `{oldPassword,newPassword}` |
| GET | `/api/inquiry/state` | Return accounts, filters metadata, model status, and sync summaries |
| POST | `/api/inquiry/accounts/probe` | Probe `{config,accountId}` with count 1 and no message read |
| POST | `/api/inquiry/accounts/save` | Save a previously probed `{accountId,displayName,enabled}` |
| POST | `/api/inquiry/accounts/remove` | Remove `{accountId,clearData}` |
| POST | `/api/inquiry/sync` | Sync `{config,accountId,maxConversations}` |
| GET | `/api/inquiry/conversations` | List filtered summaries from query parameters |
| GET | `/api/inquiry/conversation?id=` | Return one conversation timeline |
| POST | `/api/inquiry/deepseek/test` | Test supplied Key without saving it |
| POST | `/api/inquiry/deepseek/save` | Encrypt `{baseUrl,apiKey,model}` in settings |
| POST | `/api/inquiry/deepseek/remove` | Remove encrypted model settings |
| POST | `/api/inquiry/review/preview` | Return mandatory-redacted preview for one conversation |
| POST | `/api/inquiry/review/run` | Require `{conversationId,previewFingerprint,confirmed:true}`, run once, encrypt result |
| POST | `/api/inquiry/clear` | Clear `{accountId}` or `{all:true}` after `{confirmed:true}` |

The preview fingerprint is SHA-256 over conversation ID, ordered message IDs, message content hashes, redaction version, and model name. The run route recomputes it so changed messages or model settings invalidate confirmation.

Keep successful account probes in an in-memory map for 10 minutes. `/accounts/save` requires a matching unexpired probe entry and consumes it; callers cannot bypass the probe by posting directly to save. Track failed unlock attempts in memory and reject attempts made before `min(30 seconds, 2 ** failures seconds)` has elapsed. For `/sync`, set a `clientClosed` flag on the request `close` event and pass `shouldContinue: () => !clientClosed` to the sync service.

- [ ] **Step 4: Wire handler and dependencies into the server**

In `createServer()` create one random token and one vault instance per server:

```js
import * as inquiryClient from './inquiry-client.js';
import { createInquiryRouteHandler } from './inquiry-routes.js';
import { createInquirySyncService } from './inquiry-sync.js';
import { createInquiryVaultStore } from './inquiry-vault.js';
import { reviewConversation as defaultReviewConversation } from './inquiry-review.js';

const inquiryPageToken = options.inquiryPageToken
  ?? crypto.randomBytes(32).toString('base64url');
const inquiryVault = options.inquiryVault ?? createInquiryVaultStore(rootDir);
const inquiryRouteHandler = options.inquiryRouteHandler ?? createInquiryRouteHandler({
  rootDir, pageToken: inquiryPageToken, vault: inquiryVault,
  syncService: createInquirySyncService({ vault: inquiryVault, client: inquiryClient }),
  reviewConversation: defaultReviewConversation,
  testAiConnection,
});
```

Create the HTTP server in a local variable and attach `server.on('close', () => inquiryVault.lock())` before returning it, so test shutdown and normal service shutdown zero the in-memory vault key.

Delegate before the generic `/api/*` 404:

```js
if (url.pathname.startsWith('/api/inquiry/')
  && await inquiryRouteHandler.handle(request, response, url)) return;
```

Inject all dependencies in tests. Do not log request bodies.

- [ ] **Step 5: Run route and server tests**

Run: `node --test tests/inquiry-routes.test.js tests/server.test.js`

Expected: all selected tests PASS; existing Alibaba routes preserve their behavior.

- [ ] **Step 6: Commit protected routes**

```powershell
git add src/inquiry-routes.js src/server.js tests/inquiry-routes.test.js tests/server.test.js
git commit -m "feat: expose protected inquiry routes"
```

### Task 7: Inquiry page shell and responsive layout

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `tests/inquiry-review-ui.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces DOM IDs consumed by Task 8: `inquiry-vault-panel`, `inquiry-password`, `inquiry-unlock`, `inquiry-old-password`, `inquiry-new-password`, `inquiry-change-password`, `inquiry-account-form`, `inquiry-account-name`, `inquiry-account-id`, `inquiry-account-probe`, `inquiry-account-save`, `inquiry-account-list`, `inquiry-sync`, `inquiry-date-from`, `inquiry-date-to`, `inquiry-unanswered`, `inquiry-conversation-list`, `inquiry-timeline`, `inquiry-metrics`, `inquiry-review-preview`, `inquiry-review-run`, `inquiry-review-result`, `inquiry-deepseek-base-url`, `inquiry-deepseek-model`, `inquiry-deepseek-key`, `inquiry-deepseek-test`, `inquiry-deepseek-save`, `inquiry-deepseek-remove`, `inquiry-clear-account`, `inquiry-clear-all`, `inquiry-status`.

- [ ] **Step 1: Write failing structural UI tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('inquiry page exposes the approved three-column and confirmation controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const sidebar = html.match(/<nav class="module-nav">([\s\S]*?)<\/nav>/)?.[1] || '';
  assert.deepEqual([...sidebar.matchAll(/data-module="([^"]+)"/g)].map((item) => item[1]),
    ['obsidian-publishing', 'inquiry-review', 'alibaba-settings']);
  assert.match(html, /id="module-inquiry-review"/);
  assert.match(html, /class="inquiry-workspace"/);
  assert.match(html, /id="inquiry-conversation-list"/);
  assert.match(html, /id="inquiry-timeline"/);
  assert.match(html, /id="inquiry-review-preview"/);
  assert.match(html, /DeepSeek 复盘会产生模型 Token 用量/);
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/inquiry-review-ui.test.js tests/server.test.js`

Expected: FAIL because the navigation and inquiry page do not exist.

- [ ] **Step 3: Add the navigation item and semantic page markup**

Add `询盘复盘` between `Obsidian 上品` and `阿里接口`. Keep Obsidian as the initial active page. The inquiry page contains a compact header, locked-state panel, three-column workspace, a native `<dialog>` for the redacted preview, and an inline DeepSeek configuration disclosure. Do not restore the old `AI 接口` navigation button.

Use real labels and empty states:

```html
<section class="module-page" id="module-inquiry-review" aria-labelledby="inquiry-title" hidden>
  <header class="page-header compact-page-header">
    <div><p class="kicker">INQUIRY REVIEW</p><h1 id="inquiry-title">询盘复盘</h1>
      <p>只读同步业务员会话；选择聊天后可使用 DeepSeek 做有依据的复盘。</p></div>
  </header>
  <p id="inquiry-status" class="status" aria-live="polite"></p>
  <section id="inquiry-vault-panel" class="inquiry-vault-panel" aria-label="本地加密资料库"></section>
  <section class="inquiry-workspace" hidden>
    <aside class="inquiry-filters" aria-label="业务员与筛选"></aside>
    <section class="inquiry-conversations" aria-label="会话列表"></section>
    <section class="inquiry-detail" aria-label="聊天与复盘"></section>
  </section>
</section>
```

- [ ] **Step 4: Add scoped desktop and responsive styles**

Use the existing color and spacing variables. At desktop width use `minmax(220px, .8fr) minmax(280px, 1fr) minmax(420px, 1.7fr)`. Below 1050px make filters a full-width row and keep list/detail as two columns. Below 720px use one column. Messages align by speaker but retain visible `业务员`/`客户` text labels; do not rely on color alone.

- [ ] **Step 5: Run UI and server tests**

Run: `node --test tests/inquiry-review-ui.test.js tests/server.test.js`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit the page shell**

```powershell
git add public/index.html public/styles.css tests/inquiry-review-ui.test.js tests/server.test.js
git commit -m "feat: add inquiry review workspace"
```

### Task 8: Browser behavior, filtering, confirmations, and DeepSeek settings

**Files:**
- Create: `public/inquiry-review.js`
- Modify: `public/app.js`
- Modify: `src/server.js`
- Modify: `tests/inquiry-review-ui.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `initInquiryReview({requestJson,getAlibabaConfig,setStatus})`.
- Consumes: all Task 7 DOM IDs.
- Browser state: `{pageToken,vault,accounts,conversations,selectedConversationId,reviewPreviewFingerprint,deepSeekConfigured}`.
- Inquiry requests add `X-ICBU-Page-Token`; Alibaba credentials are read at action time from `getAlibabaConfig()` and never copied into inquiry state or browser storage.

- [ ] **Step 1: Write failing browser state and rendering tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterConversationSummaries,
  formatDuration,
  renderConversationSummary,
} from '../public/inquiry-review.js';

test('conversation filters combine account, dates, and unanswered state', () => {
  const rows = [
    { conversationId: 'c1', accountId: 's1', latestMessageTime: 20, metrics: { unanswered: true } },
    { conversationId: 'c2', accountId: 's2', latestMessageTime: 30, metrics: { unanswered: false } },
  ];
  assert.deepEqual(filterConversationSummaries(rows, {
    accountId: 's1', from: 10, to: 25, unansweredOnly: true,
  }).map((item) => item.conversationId), ['c1']);
});

test('summary rendering escapes customer-provided HTML', () => {
  const html = renderConversationSummary({
    conversationId: 'c1', buyerDisplayName: '<img src=x onerror=alert(1)>',
    lastMessagePreview: '<script>bad</script>', latestMessageTime: 20,
    metrics: { unanswered: true, unansweredMs: 5000 },
  });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: Run the focused UI tests and verify failure**

Run: `node --test tests/inquiry-review-ui.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/inquiry-review.js`.

- [ ] **Step 3: Implement boot, vault lifecycle, accounts, and sync**

```js
async function inquiryRequest(path, options = {}) {
  return requestJson(path, {
    ...options,
    headers: { ...options.headers, 'X-ICBU-Page-Token': state.pageToken },
  });
}

async function boot() {
  const bootstrap = await requestJson('/api/inquiry/bootstrap');
  state.pageToken = bootstrap.pageToken;
  state.vault = bootstrap.vault;
  renderVaultState();
  if (!bootstrap.vault.locked) await refreshState();
}
```

Create/unlock requires a 12-character password and clears the input immediately after the request. Password change requires both old and new values, clears both fields immediately, and preserves the unlocked state after success. Account save remains disabled until the exact entered account ID has a successful probe result. Sync reads `getAlibabaConfig()` only inside the click handler, disables the button while running, and shows page and conversation counts without printing raw errors.

- [ ] **Step 4: Implement conversation selection, metrics, and safe timeline rendering**

Use DOM node creation and `textContent` for customer-controlled values. Export the pure filter, duration, and escaped-summary helpers for Node tests. Selecting a row loads one encrypted conversation, renders ordered messages, and clears any earlier review preview when the conversation changes.

- [ ] **Step 5: Implement DeepSeek configuration and two-step review confirmation**

The page defaults Base URL to `https://api.deepseek.com`. It never restores a Key from `localStorage`. `测试连接` submits the typed Key but does not save it. `保存` encrypts the configuration in the unlocked vault and then clears the Key input. Put `inquiryRequest` inside `initInquiryReview` so it closes over the injected `requestJson` and the module state; do not create a second generic HTTP client.

`生成复盘预览` requests `/api/inquiry/review/preview` and opens the dialog containing message count, date range, model, Token warning, and the exact redacted text. `确认并复盘` submits the returned fingerprint plus `confirmed:true`; closing the dialog or changing conversations discards the fingerprint.

Removing DeepSeek configuration requires confirmation and clears the model status without deleting chat data. Removing an account presents separate choices for configuration-only removal and configuration-plus-local-chat removal. `清空全部资料库` displays account, conversation, message, and review counts and calls the clear route only after explicit confirmation; it leaves the vault itself available and unlocked.

- [ ] **Step 6: Serve and initialize the browser module**

Add `/inquiry-review.js` to `serveStatic()`. Import and initialize from `public/app.js`:

```js
import { initInquiryReview } from './inquiry-review.js';

initInquiryReview({ requestJson, getAlibabaConfig, setStatus });
```

Do not add the old AI settings page to navigation. Existing AI functionality remains available to existing code paths.

- [ ] **Step 7: Run UI and server tests**

Run: `node --test tests/inquiry-review-ui.test.js tests/server.test.js`

Expected: all selected tests PASS, including HTML escaping, token headers, disabled gates, and static module delivery.

- [ ] **Step 8: Commit browser behavior**

```powershell
git add public/inquiry-review.js public/app.js src/server.js tests/inquiry-review-ui.test.js tests/server.test.js
git commit -m "feat: connect inquiry review interface"
```

### Task 9: Documentation, full regression, and staged real acceptance

**Files:**
- Modify: `README.md`
- Modify: `WORK_MACHINE_SETUP.md`
- Modify: `AGENTS.md`
- Test: all files under `tests/`

**Interfaces:**
- Documents the exact local data directory, startup unlock step, API methods, DeepSeek setup, retention, manual sync, and stop gates.
- Updates `AGENTS.md` with the permanent inquiry read-only allowlist and prohibition on message sending.

- [ ] **Step 1: Write the documentation acceptance assertions**

Add to `tests/portability.test.js`:

```js
test('docs state inquiry privacy, retention, and read-only boundaries', async () => {
  const readme = await readFile(path.join(rootDir, 'README.md'), 'utf8');
  const setup = await readFile(path.join(rootDir, 'WORK_MACHINE_SETUP.md'), 'utf8');
  const agents = await readFile(path.join(rootDir, 'AGENTS.md'), 'utf8');
  for (const text of [readme, setup]) {
    assert.match(text, /data[\\/]inquiry-review/);
    assert.match(text, /90 天/);
    assert.match(text, /DeepSeek/);
  }
  assert.match(agents, /alibaba\.interaction\.im\.conversation\.list\.query/);
  assert.match(agents, /禁止.*发送.*消息/);
});
```

- [ ] **Step 2: Run the documentation test and verify failure**

Run: `node --test tests/portability.test.js`

Expected: FAIL because the three documents do not yet describe the inquiry subsystem.

- [ ] **Step 3: Document operation and permanent safety boundaries**

README instructions must say:

1. Open `询盘复盘`, create/unlock the encrypted vault, and add one business account.
2. Configure DeepSeek inside that page; only connection tests and confirmed reviews consume model Tokens.
3. Sync is manual and read-only; generated replies are never sent.
4. Local encrypted data lives in `data/inquiry-review/` and expires after 90 days.
5. Losing the vault password means encrypted chats cannot be recovered; do not put the password in the repository.

WORK_MACHINE_SETUP must add a checklist for the ignored vault directory and explain that it does not move with Git. AGENTS must list the two allowed inquiry reads and permanently prohibit message-send APIs, scraping, background sync, plaintext persistence, and logging chat bodies.

- [ ] **Step 4: Run all automated tests**

Run: `npm test`

Expected: the complete suite PASS with zero failures and no network access.

- [ ] **Step 5: Scan the tracked diff for sensitive or forbidden behavior**

Run:

```powershell
rg -n "message\.send|chat.*send|browser.*scrap|apiKey\s*[:=]\s*['\"]|appSecret\s*[:=]\s*['\"]|private chat|buyer@example" src public docs tests
git diff --check
git status --short
```

Expected: no Alibaba message-write implementation, no real credentials or chat fixtures, no whitespace errors, and only intentional source/docs/test changes plus ignored local `data/`.

- [ ] **Step 6: Commit documentation and regression guards**

```powershell
git add AGENTS.md README.md WORK_MACHINE_SETUP.md tests/portability.test.js
git commit -m "docs: document inquiry review safeguards"
```

- [ ] **Step 7: Restart the local service and verify local health only**

Stop the existing Node process for this exact worktree, run `npm start`, and open `http://127.0.0.1:54025/`. Verify `/api/health` returns `{\"ok\":true}`, the page contains `询盘复盘`, and Obsidian 上品 remains the default module.

Expected: workbench loads locally. Do not enter credentials or call Alibaba/DeepSeek during this step.

- [ ] **Step 8: Stop for explicit authorization before the first real permission probe**

Report automated test results and request permission to use the currently entered Alibaba AppKey/App Secret for exactly one call to `alibaba.interaction.im.conversation.list.query` with `count=1` and one user-supplied business account ID.

Expected: no real API call occurs until the user explicitly approves this post-implementation probe.

- [ ] **Step 9: Perform staged acceptance only after authorization**

After approval:

1. Probe one business account with conversation count 1.
2. Report capability success, legitimate empty result, or the exact sanitized error category.
3. If capability succeeds, stop again and ask before reading one conversation body.
4. After the second approval, sync with `maxConversations:1` and let the user verify participants, order, and metrics.
5. Stop again and ask before the first DeepSeek review.
6. After the third approval, show the redacted preview, require UI confirmation, run one review, and report actual Token usage.

Expected: each stage remains independently reversible and no Alibaba message-write method exists.

## Completion Gate

Do not claim the feature complete until:

- every task commit exists;
- `npm test` passes with zero failures;
- the sensitive-data scan is clean;
- the local workbench starts and `/api/health` succeeds;
- the UI gates prevent sync while locked, account save before probe, and review before matching preview confirmation;
- the implementation contains only the two approved Alibaba inquiry read methods;
- no real permission probe, message read, or DeepSeek review has run without its separate user authorization.
