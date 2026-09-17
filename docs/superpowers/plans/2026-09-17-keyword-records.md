# Keyword Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, locally persisted “关键词记录” module for Product-ID inquiry keywords and optional-Product-ID blocked keywords.

**Architecture:** A focused JSON store owns validation, case-insensitive deduplication, CRUD, batch import, and atomic writes to `data/keyword-records.json`. The existing Node HTTP server exposes thin JSON routes, while one standalone browser module owns rendering and interaction inside a new page that reuses the current navigation and visual system.

**Tech Stack:** Node.js 20+ native ESM, `node:http`, `node:fs/promises`, browser ES modules, HTML, CSS, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-17-keyword-records-design.md`

## Global Constraints

- Persist only `id`, `product_id`, `keyword`, optional `note`, and `created_at`.
- Do not add a database, framework, package, background task, Alibaba API call, AI call, analytics field, chart, or history model.
- `blocked_keywords.product_id` may be `null`; inquiry keywords always require an existing Product ID.
- Preserve all unrelated working-tree changes in the existing dirty worktree.
- Follow test-first development and keep each production edit limited to the behavior asserted by a failing test.
- The repository has no `lint`, `typecheck`, or `build` scripts; do not invent a toolchain.

---

### Task 1: Local Keyword Record Store

**Files:**
- Create: `src/keyword-record-store.js`
- Create: `tests/keyword-record-store.test.js`

**Interfaces:**
- Produces: `createKeywordRecordStore(rootDir, deps?)`.
- Produces store methods: `readAll()`, `addProduct(input)`, `removeProduct(id)`, `addInquiryKeyword(input)`, `updateInquiryKeyword(id, input)`, `removeInquiryKeyword(id)`, `batchAddInquiryKeywords(input)`, `addBlockedKeyword(input)`, `updateBlockedKeyword(id, input)`, `removeBlockedKeyword(id)`, and `batchAddBlockedKeywords(input)`.
- Every mutation returns the newly persisted full dataset except batch methods, which return `{ data, added, skipped }`.

- [ ] **Step 1: Write failing tests for empty storage and Product ID lifecycle**

```js
test('keyword record store starts empty and persists trimmed unique numeric Product IDs', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'keyword-records-'));
  const store = createKeywordRecordStore(rootDir, {
    now: () => new Date('2026-09-17T00:00:00.000Z'),
    randomUUID: () => 'product-1',
  });
  assert.deepEqual(await store.readAll(), {
    products: [], inquiry_keywords: [], blocked_keywords: [],
  });
  const data = await store.addProduct({ product_id: ' 1601954851686 ' });
  assert.equal(data.products[0].product_id, '1601954851686');
  await assert.rejects(() => store.addProduct({ product_id: '1601954851686' }), /已存在/);
  await assert.rejects(() => store.addProduct({ product_id: 'ABC' }), /只能包含数字/);
});
```

- [ ] **Step 2: Run the store test and verify RED**

Run: `node --test tests/keyword-record-store.test.js`

Expected: FAIL because `src/keyword-record-store.js` does not exist.

- [ ] **Step 3: Implement the empty dataset, Product ID validation, atomic write, add, and remove behavior**

```js
export function createKeywordRecordStore(rootDir, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const randomUUID = deps.randomUUID ?? crypto.randomUUID;
  return {
    readAll,
    addProduct,
    removeProduct,
    // Keyword methods are added by the next RED cycle.
  };
}
```

`removeProduct(id)` must remove the product and all matching `inquiry_keywords`, retain `blocked_keywords`, and return 404-style errors for unknown record IDs.

- [ ] **Step 4: Run the Product ID tests and verify GREEN**

Run: `node --test tests/keyword-record-store.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing tests for inquiry keyword CRUD and batch deduplication**

```js
test('inquiry keyword batch import trims lines and skips case-insensitive duplicates', async () => {
  const result = await store.batchAddInquiryKeywords({
    product_id: '1601954851686',
    keywords: ' reflective safety vest\n\nHIGH VISIBILITY VEST\nreflective safety vest ',
  });
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.data.inquiry_keywords.map((item) => item.keyword), [
    'reflective safety vest', 'HIGH VISIBILITY VEST',
  ]);
});
```

Also assert: unknown Product ID is rejected, note is optional and trimmed, editing preserves `created_at`, duplicate edits are rejected, and delete removes exactly one record.

- [ ] **Step 6: Run inquiry tests and verify RED**

Run: `node --test tests/keyword-record-store.test.js`

Expected: FAIL because inquiry keyword methods are missing.

- [ ] **Step 7: Implement minimal inquiry keyword CRUD and batch behavior**

Use one normalization helper for `keyword`, one for `note`, and compare duplicates with `keyword.toLocaleLowerCase()` within the same `product_id`.

- [ ] **Step 8: Run inquiry tests and verify GREEN**

Run: `node --test tests/keyword-record-store.test.js`

Expected: PASS.

- [ ] **Step 9: Write failing tests for blocked keyword CRUD and nullable Product ID batch import**

```js
test('blocked keyword uniqueness includes the nullable Product ID', async () => {
  const first = await store.batchAddBlockedKeywords({
    product_id: null,
    keywords: 'fashion vest\nFASHION VEST\ncycling clothing',
  });
  assert.deepEqual({ added: first.added, skipped: first.skipped }, { added: 2, skipped: 1 });
  const second = await store.addBlockedKeyword({
    product_id: '1601954851686', keyword: 'fashion vest', note: '产品不相关',
  });
  assert.equal(second.blocked_keywords.length, 3);
});
```

Also assert: blank keyword is rejected, non-empty Product ID must be numeric, edit preserves `created_at`, and delete removes exactly one blocked keyword.

- [ ] **Step 10: Run blocked keyword tests and verify RED**

Run: `node --test tests/keyword-record-store.test.js`

Expected: FAIL because blocked keyword methods are missing.

- [ ] **Step 11: Implement blocked keyword CRUD and batch behavior**

Normalize empty `product_id` values to `null`. Compare duplicates using `${product_id ?? ''}\u0000${keyword.toLocaleLowerCase()}`.

- [ ] **Step 12: Run all store tests and verify GREEN**

Run: `node --test tests/keyword-record-store.test.js`

Expected: PASS with no warnings.

- [ ] **Step 13: Commit the isolated new store files**

```powershell
git add -- src/keyword-record-store.js tests/keyword-record-store.test.js
git commit -m "feat: add local keyword record store"
```

---

### Task 2: Local HTTP API

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `createKeywordRecordStore(rootDir)` from Task 1.
- Produces the eleven routes defined in the design spec under `/api/keyword-records`.
- Error responses use the existing `{ error }` JSON envelope and store-provided `status` values.

- [ ] **Step 1: Add failing server tests for read, Product ID add, and Product ID delete**

```js
test('keyword record routes read and mutate Product IDs', async () => {
  await withServer(async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/api/keyword-records`);
    assert.deepEqual(await empty.json(), {
      products: [], inquiry_keywords: [], blocked_keywords: [],
    });
    const added = await fetch(`${baseUrl}/api/keyword-records/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: '1601954851686' }),
    });
    assert.equal(added.status, 201);
  });
});
```

- [ ] **Step 2: Run the focused server test and verify RED**

Run: `node --test --test-name-pattern="keyword record routes" tests/server.test.js`

Expected: FAIL with 404/invalid JSON because routes are absent.

- [ ] **Step 3: Add server dependency and minimal Product ID routes**

Import `createKeywordRecordStore`, initialize `const keywordRecordStore = options.keywordRecordStore ?? createKeywordRecordStore(rootDir);`, and add thin route branches before the static-file fallback.

- [ ] **Step 4: Run the focused server test and verify GREEN**

Run: `node --test --test-name-pattern="keyword record routes" tests/server.test.js`

Expected: PASS.

- [ ] **Step 5: Add failing route tests for inquiry keyword CRUD and batch results**

Assert 201 for create, 200 for patch/delete, and `{ added: 2, skipped: 1, data }` for a mixed batch.

- [ ] **Step 6: Run inquiry route tests and verify RED**

Run: `node --test --test-name-pattern="inquiry keyword routes" tests/server.test.js`

Expected: FAIL because the inquiry routes are absent.

- [ ] **Step 7: Implement the five inquiry keyword route branches**

Match record IDs with a narrow pathname regex and decode only the captured ID. Forward request bodies unchanged to the store after `readJson`.

- [ ] **Step 8: Run inquiry route tests and verify GREEN**

Run: `node --test --test-name-pattern="inquiry keyword routes" tests/server.test.js`

Expected: PASS.

- [ ] **Step 9: Add failing route tests for blocked keyword CRUD, filtering inputs, and batch results**

Filtering remains client-side, so the GET response must include only the stored lightweight fields; assert nullable `product_id` survives JSON round-trip.

- [ ] **Step 10: Run blocked route tests and verify RED**

Run: `node --test --test-name-pattern="blocked keyword routes" tests/server.test.js`

Expected: FAIL because the blocked routes are absent.

- [ ] **Step 11: Implement the five blocked keyword route branches**

Return batch counts from the store and never turn an individual duplicate into an HTTP error.

- [ ] **Step 12: Run keyword API tests and the complete server test file**

Run: `node --test --test-name-pattern="keyword" tests/server.test.js`

Run: `node --test tests/server.test.js`

Expected: both commands PASS.

- [ ] **Step 13: Preserve dirty unrelated server changes**

Review `git diff -- src/server.js tests/server.test.js` and verify every newly added hunk mentions `keywordRecordStore` or `/api/keyword-records`. Do not commit these overlapping dirty files independently unless their exact hunks can be staged without including pre-existing changes.

---

### Task 3: Keyword Records UI

**Files:**
- Create: `public/keyword-records.js`
- Create: `tests/keyword-records-ui.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes the Task 2 JSON routes.
- Produces `initKeywordRecords({ requestJson })`, plus pure helpers `parseKeywordLines(text)`, `filterProducts(products, query)`, `filterInquiryKeywords(items, query)`, and `filterBlockedKeywords(items, keywordQuery, productId)` for direct tests.
- The initializer is idempotent and loads data only when the user opens the module.

- [ ] **Step 1: Write failing pure UI tests for line parsing and filters**

```js
test('parseKeywordLines trims, removes blanks, and deduplicates case-insensitively', () => {
  assert.deepEqual(parseKeywordLines(' vest \n\nVEST\nworkwear'), ['vest', 'workwear']);
});
```

Assert Product ID substring search, inquiry keyword/note search, and blocked keyword plus exact Product ID filter.

- [ ] **Step 2: Run the UI unit test and verify RED**

Run: `node --test tests/keyword-records-ui.test.js`

Expected: FAIL because `public/keyword-records.js` does not exist.

- [ ] **Step 3: Implement pure helpers and a minimal exported initializer shell**

The initializer should query elements only inside `#module-keyword-records`, attach listeners once, and call `GET /api/keyword-records` on first activation.

- [ ] **Step 4: Run UI unit tests and verify GREEN**

Run: `node --test tests/keyword-records-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Add failing static-structure tests**

Read `public/index.html`, `public/app.js`, and `public/styles.css` as text and assert:

```js
assert.match(html, /data-module="keyword-records"/);
assert.match(html, /id="module-keyword-records"/);
assert.match(html, /询盘词库/);
assert.match(html, /直通车屏蔽词/);
assert.match(html, /id="keyword-batch-dialog"/);
assert.match(app, /initKeywordRecords/);
assert.match(css, /\.keyword-record-layout/);
```

- [ ] **Step 6: Run static UI tests and verify RED**

Run: `node --test tests/keyword-records-ui.test.js`

Expected: FAIL because navigation, page DOM, dialogs, initializer wiring, and styles are absent.

- [ ] **Step 7: Add the navigation entry and page markup**

Add one navigation button and one hidden `module-page` containing:

- Tab buttons for inquiry and blocked views.
- Inquiry two-column layout with Product ID search/list/actions and selected-product keyword search/list/actions.
- Blocked keyword toolbar and compact table.
- One batch dialog whose labels and Product ID requirement change by active view.
- One lightweight record-edit dialog reused for inquiry and blocked single-record create/edit.

Do not add product names, images, SKU, categories, metrics, charts, or extra cards.

- [ ] **Step 8: Implement the initializer wiring and CRUD interactions**

Import and call `initKeywordRecords({ requestJson })` from `public/app.js`. When `switchModule('keyword-records')` runs, invoke the returned controller's `load()` once. Use `window.confirm` only for local delete confirmation. After mutations, replace local state with the API response and re-render.

- [ ] **Step 9: Add focused styles matching the current workbench**

Reuse `.button`, page header, panel colors, table borders, input sizing, and typography. Add only layout selectors for the tab row, two-column inquiry area, Product ID rows, keyword rows, blocked table, and responsive single-column fallback.

- [ ] **Step 10: Run UI tests and verify GREEN**

Run: `node --test tests/keyword-records-ui.test.js`

Expected: PASS.

- [ ] **Step 11: Review overlapping dirty frontend files**

Run: `git diff -- public/index.html public/app.js public/styles.css` and verify new hunks are limited to the keyword navigation, page DOM, initializer import/call, module-load hook, and keyword styles. Do not stage unrelated pre-existing changes.

---

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the local-only keyword records module and `data/keyword-records.json` persistence path.

- [ ] **Step 1: Add one concise README module entry**

Document that “关键词记录” stores Product-ID inquiry keywords and optional-Product-ID blocked keywords locally and makes no Alibaba or AI calls.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
node --test tests/keyword-record-store.test.js tests/keyword-records-ui.test.js
node --test --test-name-pattern="keyword" tests/server.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run full regression tests**

Run: `npm test`

Expected: exit code 0 and zero failed tests.

- [ ] **Step 4: Record unavailable requested scripts**

Run: `npm run`

Expected: output lists only `start` and `test`; therefore `lint`, `typecheck`, and `build` are not configured and are reported as unavailable rather than falsely claimed.

- [ ] **Step 5: Restart and smoke-test the local service**

Start with `node src/server.js`, request `GET http://127.0.0.1:54025/api/keyword-records`, and open the existing workbench. Verify the new navigation entry is present, an added test Product ID survives a page refresh, then remove only that test record through the UI.

- [ ] **Step 6: Final diff and requirement audit**

Run `git status --short`, `git diff --check`, and review the design spec requirement-by-requirement. Confirm no secrets, real task JSON, product fields, analytics fields, Alibaba calls, or unrelated refactors were added.
