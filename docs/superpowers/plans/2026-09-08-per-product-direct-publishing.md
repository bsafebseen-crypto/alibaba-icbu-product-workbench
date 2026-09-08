# Obsidian Per-Product Direct Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click, per-card Alibaba product publishing that writes once, serializes all product writes, verifies the published product, and recovers a lost response without creating a duplicate.

**Architecture:** Extend the existing deterministic Obsidian preview pipeline with a separate formal-publication state machine. A global server lock covers draft and formal product writes; `schema.add` is called once only after a persisted baseline snapshot, while read-only `product.list`, `product.get`, and `schema.render` reconcile the outcome. The browser renders persisted states and resumes read-only reconciliation when credentials become available after a reload.

**Tech Stack:** Node.js 20+ native ESM, Node HTTP server, browser ES modules without a framework, Node built-in test runner, existing Alibaba TOP client and XML schema utilities.

**Spec:** `docs/superpowers/specs/2026-09-08-per-product-direct-publishing-design.md`

## Global Constraints

- A card click is the only authorization for `alibaba.icbu.product.schema.add`; it publishes that card only and shows no additional confirmation dialog.
- Every formal publication attempt calls `schema.add` at most once.
- Draft and formal product creation share one global write lock and a fixed 3-second cooldown.
- A timeout or malformed response enters read-only reconciliation and never resubmits the write.
- Publication success requires an existing formal product whose title, selling points, five FAQs, ten custom attributes, and six exact image IDs match the preview.
- Protected price, SKU, standard attributes, logistics, details, and unrecognized fields remain inherited and are never guessed or repaired.
- Credentials, complete XML, image bytes, and real task data never enter Git, logs, or persisted publication metadata.
- Credentials remain browser-supplied; after a server restart, opening the workbench resumes pending read-only reconciliation without persisting tokens on disk.
- Automated tests use mocks and temporary task directories only; they must never call a real Alibaba write endpoint.
- No new framework, database, background directory watcher, or model call is introduced.

---

### Task 1: Commit the existing draft single-flight and post-create verification baseline

**Files:**
- Modify: `src/server.js`
- Modify: `public/obsidian-publishing.js`
- Test: `tests/server.test.js`
- Test: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Consumes: existing `createAlibabaProductDraft()` and `loadAlibabaProductDraft()`.
- Produces: a verified draft route and browser `draftSubmissionPlanId` lock on which the global product-write lock will build.

- [ ] **Step 1: Inspect the current unstaged patch and confirm it contains only the approved draft reliability fix**

Run: `git diff -- src/server.js public/obsidian-publishing.js tests/server.test.js tests/obsidian-publishing-ui.test.js`

Expected: server serializes draft submission per preview session and verifies returned draft IDs; UI locks all draft buttons while the request runs; tests cover both behaviors.

- [ ] **Step 2: Run the focused draft tests**

Run: `node --test tests/server.test.js tests/obsidian-publishing-ui.test.js`

Expected: all focused tests pass, including `marks the result unknown when Alibaba returns an unreadable draft id` and `serializes creation across plans`.

- [ ] **Step 3: Run the full regression suite**

Run: `npm test`

Expected: exit code 0 and no failing tests.

- [ ] **Step 4: Commit only the four baseline files**

```powershell
git add -- src/server.js public/obsidian-publishing.js tests/server.test.js tests/obsidian-publishing-ui.test.js
git commit -m "fix: verify and serialize draft creation"
```

### Task 2: Add strict Alibaba formal-publish and product-list clients

**Files:**
- Modify: `src/alibaba-client.js`
- Test: `tests/alibaba-client.test.js`

**Interfaces:**
- Consumes: `callAlibabaApi(config, method, params, fetchImpl, timestamp)`.
- Produces:
  - `createAlibabaProduct(config, { schemaXml, publishContext }, fetchImpl?, timestamp?) -> { productId, traceId, requestId }`
  - `listAlibabaProducts(config, { subject, categoryId, modifiedFrom, modifiedTo, pageSize? }, fetchImpl?, timestamp?) -> { products, requestId }`

- [ ] **Step 1: Write failing client tests**

Add tests asserting that `createAlibabaProduct` calls only `alibaba.icbu.product.schema.add`, sends this envelope, and normalizes the safe response:

```js
{
  param_product_top_publish_request: {
    publish_type: 'default',
    xml: '<itemSchema />',
    cat_id: '301504',
    language: 'en_US',
    version: 'trade.1.1',
  },
}
```

Add explicit `biz_success=false`, missing-ID, and transport-timeout cases. Add `listAlibabaProducts` tests asserting `language: 'ENGLISH'`, exact `subject`, `category_id`, `gmt_modified_from`, `gmt_modified_to`, `current_page: 1`, `page_size: 30`, and a normalized array containing only safe summary fields such as product ID, subject, category, status, display, and modification time.

- [ ] **Step 2: Run the client tests to verify RED**

Run: `node --test tests/alibaba-client.test.js`

Expected: FAIL because the two exports do not exist.

- [ ] **Step 3: Implement the two minimal client functions**

Use the same validation and error metadata pattern as `createAlibabaProductDraft`. `createAlibabaProduct` must set `error.definitive=true` only for an explicit business rejection. `listAlibabaProducts` must reject an empty title or category, cap `pageSize` at 30, map `en_US` to literal `ENGLISH`, and never return a raw response body.

- [ ] **Step 4: Run client tests to verify GREEN**

Run: `node --test tests/alibaba-client.test.js`

Expected: all Alibaba client tests pass.

- [ ] **Step 5: Commit the client boundary**

```powershell
git add -- src/alibaba-client.js tests/alibaba-client.test.js
git commit -m "feat: add formal product publishing client"
```

### Task 3: Add formal-publication state and safe persistence

**Files:**
- Modify: `src/publishing-state.js`
- Modify: `src/obsidian-task-store.js`
- Test: `tests/publishing-state.test.js`
- Test: `tests/obsidian-task-store.test.js`

**Interfaces:**
- Consumes: task items with `planId`, `fingerprint`, and `status: 'preview_ready'`.
- Produces:
  - `beginPublicationAttempt(item, { fingerprint, baselineProductIds, expectedImageIds, startedAt })`
  - `markPublicationReconciling(item, { productId?, candidateProductIds?, traceId?, requestId?, error?, nextCheckAt })`
  - `finishPublicationVerification(item, { productId, traceId?, requestId?, verifiedAt })`
  - `rejectPublicationAttempt(item, error, completedAt)`
  - `markPublicationAmbiguous(item, { candidateProductIds, nextCheckAt })`
  - `markPublicationUnresolved(item, { candidateProductIds, completedAt })`
  - `listObsidianPublications(rootDir)` returning safe pending and completed records.

- [ ] **Step 1: Write failing state-transition tests**

Cover this exact graph:

```text
preview_ready -> publishing -> reconciling -> published_verified
                             -> publish_rejected
                 reconciling -> reconciliation_ambiguous
                 reconciling -> reconciliation_unresolved
```

Assert that only `publishing` may become `reconciling` or `publish_rejected`, only a reconciliation state may become `published_verified`, a missing/mismatched fingerprint is rejected, and a published or uncertain item cannot begin a second write attempt.

- [ ] **Step 2: Write failing persistence tests**

Persist and reload `baselineProductIds`, `expectedImageIds`, `publicationProductId`, `candidateProductIds`, `publicationStartedAt`, `nextCheckAt`, `traceId`, `requestId`, `errorCode`, `errorMessage`, and `verifiedAt`. Assert arrays contain trimmed numeric IDs only, duplicates are removed, and secret-like unknown properties plus XML are discarded by `safeItem`.

- [ ] **Step 3: Run state and store tests to verify RED**

Run: `node --test tests/publishing-state.test.js tests/obsidian-task-store.test.js`

Expected: FAIL because publication transitions and safe fields are missing.

- [ ] **Step 4: Implement minimal transitions and safe storage**

Keep draft transitions unchanged. Extend `listCompletedObsidianPlanIds` so both `draft_created` and `published_verified` count as completed for the same batch identity. Add `listObsidianPublications` without returning complete XML, credentials, or image bytes.

- [ ] **Step 5: Run state and store tests to verify GREEN**

Run: `node --test tests/publishing-state.test.js tests/obsidian-task-store.test.js`

Expected: all state and persistence tests pass.

- [ ] **Step 6: Commit the state machine**

```powershell
git add -- src/publishing-state.js src/obsidian-task-store.js tests/publishing-state.test.js tests/obsidian-task-store.test.js
git commit -m "feat: persist formal publication state"
```

### Task 4: Implement deterministic publication reconciliation

**Files:**
- Create: `src/publication-reconciliation.js`
- Create: `tests/publication-reconciliation.test.js`
- Modify: `src/draft-verification.js`
- Modify: `tests/draft-verification.test.js`

**Interfaces:**
- Consumes:
  - `listAlibabaProducts(config, filters)`
  - `loadAlibabaProductContext(config, { productId })`
  - persisted `baselineProductIds`, `expectedImageIds`, start time, plan, context, and selling-point binding.
- Produces:
  - `comparePublishedProductToPlan(plan, analysis, expectedImageIds) -> { exactMatch, fields, differences }`
  - `reconciliationDelayMs(attemptNumber) -> number | null`
  - `reconcilePublication(dependencies, input) -> { kind: 'verified' | 'pending' | 'ambiguous', productId?, candidateProductIds, traceId? }`

- [ ] **Step 1: Write failing exact-image comparison tests**

Extend the existing comparison so publication recovery requires the six image `fileId` values in exact order, while preserving the existing content checks and allowed attribute-order normalization. Assert a candidate with six complete but different image IDs fails.

- [ ] **Step 2: Write failing reconciliation tests**

Cover:

- returned product ID exists and matches -> `verified`;
- returned ID is not yet readable -> `pending`;
- lost ID with one new post-baseline exact match -> `verified`;
- pre-baseline matching product -> ignored;
- zero new matches -> `pending`;
- two exact new matches -> `ambiguous`;
- list and render temporary errors -> `pending` with no write callback;
- delays `2000, 5000, 10000, 20000, 30000, 60000`, then `300000`, and `null` at the 24-hour deadline.

- [ ] **Step 3: Run reconciliation tests to verify RED**

Run: `node --test tests/publication-reconciliation.test.js tests/draft-verification.test.js`

Expected: FAIL because the module and exact-image comparison do not exist.

- [ ] **Step 4: Implement the pure reconciler**

`reconcilePublication` must query at most 30 summaries, subtract baseline IDs, prefer a returned product ID when present, read each candidate through the existing formal product context loader, analyze its Schema with the persisted selling-point binding, and return only safe IDs and comparison status. It must never accept or invoke a write dependency.

- [ ] **Step 5: Run reconciliation tests to verify GREEN**

Run: `node --test tests/publication-reconciliation.test.js tests/draft-verification.test.js`

Expected: all comparison and reconciliation tests pass.

- [ ] **Step 6: Commit the reconciler**

```powershell
git add -- src/publication-reconciliation.js tests/publication-reconciliation.test.js src/draft-verification.js tests/draft-verification.test.js
git commit -m "feat: reconcile formal publication results"
```

### Task 5: Add the guarded publication routes and global product-write lock

**Files:**
- Modify: `src/server.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Consumes: Tasks 2-4 client, state, store, and reconciliation interfaces.
- Produces:
  - `POST /api/obsidian/publication` for one fingerprint-bound first write.
  - `POST /api/obsidian/publication/reconcile` for one read-only reconciliation pass.
  - `GET /api/obsidian/publications` for safe persisted status restoration.

- [ ] **Step 1: Write failing route tests for the first write**

Assert the route requires a valid session, plan, matching fingerprint, selling-point binding, publishing capability, image IDs, and a successful baseline query. Assert task status is persisted as `publishing` before the mock `createAlibabaProduct` is entered. Assert a successful returned ID still requires mocked formal-product read and exact comparison before `published_verified` is returned.

- [ ] **Step 2: Write failing global-lock and write-once tests**

Start one deferred draft or formal request, send a second write for another plan/session, and assert HTTP 409 plus one total Alibaba write call. Advance an injected clock through the 3-second cooldown and assert the next request becomes eligible. Simulate timeout, refresh, and reconcile requests; assert `createAlibabaProduct` remains at exactly one call.

- [ ] **Step 3: Write failing reconciliation-route tests**

Assert `reconcile` accepts only persisted reconciliation states, uses browser-supplied credentials without storing them, restores a unique candidate, preserves pending/ambiguous status, and marks the item unresolved after 24 hours. Assert responses never contain XML, App Secret, Access Token, or image bytes.

- [ ] **Step 4: Run server tests to verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because publication routes and the global lock are absent.

- [ ] **Step 5: Implement one shared product-write lock and routes**

Use one in-memory lock record `{ kind, taskId, planId, releaseAt }`. Both the existing draft route and the new publication route must acquire it immediately before their first state mutation and release it into the fixed cooldown in `finally`. The formal route performs baseline read, persists `publishing`, calls `createAlibabaProduct` once, then invokes reconciliation. The read-only reconciliation route never acquires the product-write lock.

- [ ] **Step 6: Run server tests to verify GREEN**

Run: `node --test tests/server.test.js`

Expected: all server tests pass.

- [ ] **Step 7: Commit the guarded server flow**

```powershell
git add -- src/server.js tests/server.test.js
git commit -m "feat: guard one-click formal publication"
```

### Task 6: Add per-card publishing UI and automatic read-only resume

**Files:**
- Modify: `public/obsidian-publishing.js`
- Modify: `public/styles.css`
- Test: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Consumes: Task 5 publication endpoints and safe item statuses.
- Produces:
  - `beginProductWrite(state, { kind, planId }) -> boolean`
  - `finishProductWrite(state, { kind, planId })`
  - `publicationButtonView(item) -> { label, disabled, tone }`
  - automatic `resumePendingPublicationReconciliation()` after Alibaba configuration is available.

- [ ] **Step 1: Write failing UI state tests**

Assert each `preview_ready` card gets both a draft button and a red `直接正式发布此产品` button. Assert a single click builds exactly one request for that plan and does not call `window.confirm`. Assert all draft and publication controls disable while either write kind is active and remain disabled for a published or reconciliation item.

- [ ] **Step 2: Write failing resume and status-copy tests**

Assert these mappings:

```js
publishing: '正在正式发布…'
reconciling: '阿里正在同步，工作台自动核验中…'
published_verified: '正式发布成功 · <商品 ID>'
publish_rejected: '阿里明确拒绝 · 查看原因'
reconciliation_ambiguous: '正在自动辨认发布结果，禁止重复提交'
reconciliation_unresolved: '自动核验未能唯一确认，已禁止重复发布'
```

Assert page restoration calls the read-only reconcile endpoint for pending records only after credentials are available, schedules the returned `nextCheckAt`, and never calls the formal publication endpoint during resume.

- [ ] **Step 3: Run UI tests to verify RED**

Run: `node --test tests/obsidian-publishing-ui.test.js`

Expected: FAIL because publication controls and mappings are absent.

- [ ] **Step 4: Implement the minimal UI**

Render the publication button directly below the draft button. The click handler sends `config`, `sessionId`, `planId`, and `fingerprint` once without a confirmation dialog. Reuse one browser product-write state for both button kinds. On load and after Alibaba configuration changes, fetch safe publication records and perform due read-only reconciliation sequentially.

- [ ] **Step 5: Run UI tests to verify GREEN**

Run: `node --test tests/obsidian-publishing-ui.test.js`

Expected: all UI tests pass.

- [ ] **Step 6: Commit the card UI**

```powershell
git add -- public/obsidian-publishing.js public/styles.css tests/obsidian-publishing-ui.test.js
git commit -m "feat: add per-card direct publishing"
```

### Task 7: Authorize the narrow boundary and run final verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Test: all test files via `npm test`

**Interfaces:**
- Consumes: the fully tested Tasks 1-6 behavior.
- Produces: repository instructions and user documentation matching the implemented safety boundary.

- [ ] **Step 1: Update the formal-publish safety boundary**

Replace the absolute `schema.add` prohibition only for the Obsidian module with the exact constraints from the spec: per-card user click, current fingerprint, pre-write persistence, baseline snapshot, global lock, one write per attempt, read-only reconciliation, no update/down/delete/inventory methods, and no real writes in automated tests or development verification.

- [ ] **Step 2: Update operating documentation**

Document the two per-card choices, one-click behavior, global serialization, automatic reconciliation, reload/resume behavior, and the meaning of rejected, reconciling, ambiguous, and unresolved states. State that no model tokens are used by this deterministic workflow.

- [ ] **Step 3: Run structural and secret checks**

```powershell
git diff --check
rg -n "access_token|app_secret|refresh_token|<itemSchema" src public tests README.md AGENTS.md
```

Expected: no whitespace errors; any matches are allow-listed fixture/assertion text only, with no real credentials or complete production XML.

- [ ] **Step 4: Run focused publication tests**

Run: `node --test tests/alibaba-client.test.js tests/publishing-state.test.js tests/obsidian-task-store.test.js tests/publication-reconciliation.test.js tests/draft-verification.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`

Expected: all focused tests pass with zero network calls to Alibaba.

- [ ] **Step 5: Run the full regression suite**

Run: `npm test`

Expected: exit code 0 and zero failing tests.

- [ ] **Step 6: Start the local server and perform a read-only browser smoke test**

Run the workbench on `127.0.0.1:54025`, reload the existing workbench tab, and verify:

- every eligible card shows the draft and red formal-publish buttons;
- persisted status text restores correctly;
- no publication button is clicked;
- browser load and `/api/health` succeed.

- [ ] **Step 7: Commit docs and safety boundary**

```powershell
git add -- AGENTS.md README.md
git commit -m "docs: authorize guarded formal publication"
```

- [ ] **Step 8: Inspect the final branch**

Run: `git status --short` and `git log --oneline -8`.

Expected: only ignored/local runtime `data/` remains untracked; the implementation is split into reviewable commits, and no real Alibaba product was created during development.
