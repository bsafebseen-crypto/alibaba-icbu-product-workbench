# Obsidian 共享图片与真实卖点校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Obsidian 上品流程改为四张主图、共享营销副图库和两张固定副图，并修复错误卖点字段仍被判定成功的问题。

**Architecture:** 图片职责分成纯函数分配器、本机安全映射缓存和共享页面状态；所有图片按 SHA-256 去重后上传一次，再由四套方案复用。卖点职责分成明确字段绑定、结构化写入器和独立只读提取器；没有真实字段绑定时预览与草稿都阻断。旧草稿历史只用于跳过已完成方案，旧内存预览绝不恢复。

**Tech Stack:** Node.js 20+、原生 ESM、Node HTTP、浏览器 ES Modules/Web Crypto、fast-xml-parser、Node 内置测试运行器，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-27-obsidian-shared-images-selling-points-design.md`

## Global Constraints

- 不保存图片 Base64、图片字节、凭证、完整 Schema XML 或预览 XML。
- 固定图配置仅保存在本机运行时数据中，不进入 Git，不扫描父目录。
- 图片银行查询由用户主动启动；图片上传继续明确确认。
- 草稿创建继续绑定当前指纹并逐商品确认。
- `alibaba.icbu.product.schema.add` 正式发布继续禁止。
- 方案 3 创建后停止，不自动创建方案 4 或方案 5。
- 每个生产改动先写失败测试并确认按预期失败。

---

### Task 1: 真实卖点字段绑定与独立提取

**Files:**
- Create: `src/schema-role-binding.js`
- Modify: `src/schema-template.js`
- Modify: `src/draft-verification.js`
- Modify: `tests/schema-template.test.js`
- Modify: `tests/draft-verification.test.js`

**Interfaces:**
- Produces: `resolveSellingPointBinding(schemaXml, binding): SellingPointBinding`
- Produces: `writeBoundSellingPoints(schemaTree, binding, value): void`
- Produces: `readBoundSellingPoints(schemaTree, binding): string`
- `SellingPointBinding = { fieldId, carrierPath, structureType, categoryId, language, version }`

- [ ] **Step 1: Write failing tests for the current false positive**

Add a fixture containing both `textDesc` and a separate actual selling-point field. Assert the broad `textDesc` node is not selected without an explicit binding, and draft comparison cannot report `sellingPoints.match: true` by reading the same wrong carrier.

```js
assert.throws(
  () => createProductPreview(ambiguousSchema, variant),
  /卖点字段尚未校准/,
);
assert.equal(compareDraftToPlan(plan, ambiguousAnalysis).fields.sellingPoints.match, false);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/schema-template.test.js tests/draft-verification.test.js`; expect the ambiguous fixture to be accepted incorrectly before implementation.

- [ ] **Step 3: Implement explicit role binding**

Remove `textDesc` from automatic `productSummary` aliases. Add a focused module that locates exactly one field by `fieldId`, traverses only the configured `carrierPath`, and supports only `single-text` initially. Reject missing, duplicate, object-valued, or structurally changed carriers.

```js
export function readBoundSellingPoints(tree, binding) {
  const field = findUniqueFieldById(tree, binding.fieldId);
  const carrier = followPath(field, binding.carrierPath);
  if (typeof carrier.value !== 'string') throw new Error('卖点字段结构已经变化');
  return carrier.value.trim();
}
```

Pass the binding into `createProductPreview`; write and independently read it back before adding `sellingPoints` to `changedFields`. Draft verification receives the persisted non-secret binding metadata and uses only the independent reader.

- [ ] **Step 4: Run GREEN verification**

Run `node --test tests/schema-template.test.js tests/draft-verification.test.js`; expect PASS.

- [ ] **Step 5: Commit**

Stage Task 1 files and commit `fix: bind Alibaba selling points explicitly`.

---

### Task 2: 卖点只读诊断与绑定确认

**Files:**
- Modify: `src/schema-role-binding.js`
- Modify: `src/server.js`
- Modify: `public/obsidian-publishing.js`
- Modify: `public/index.html`
- Modify: `tests/server.test.js`
- Modify: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Produces: `summarizeSellingPointCandidates(schemaXml): CandidateSummary[]`
- Produces: `POST /api/obsidian/selling-points/diagnose`
- Produces: `POST /api/obsidian/selling-points/binding`
- `CandidateSummary = { fieldId, fieldName, structureType, carrierPaths, nonEmpty }`

- [ ] **Step 1: Write failing diagnostic route tests**

Assert the diagnostic response contains field IDs, names, structure shapes and non-empty flags, but not XML, unrelated field values, credentials or full product content. Assert saving a binding requires `confirmed: true`, a candidate that exists in the current mother Schema, and category/language/version context.

```js
assert.deepEqual(result.candidates[0], {
  fieldId: 'actualSellingPoint', fieldName: 'Selling Points',
  structureType: 'single-text', carrierPaths: [['value']], nonEmpty: true,
});
assert.doesNotMatch(JSON.stringify(result), /<itemSchema|access_token|product detail/i);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect missing-route failures.

- [ ] **Step 3: Implement read-only diagnostics**

The route reads the mother Schema and existing draft Schema using existing read-only clients, then returns only candidate summaries and whether the current wrong field changed. Do not persist XML. The binding route writes only field ID, carrier path, structure type and context to `data/alibaba-schema-bindings.json` using atomic replacement.

- [ ] **Step 4: Add UI calibration gate**

Show `校准卖点字段（只读）`, candidate field ID/structure, Obsidian value preview and confirmation. Until one binding is confirmed, show `卖点字段未确认` and keep preview/draft buttons disabled. Any context change invalidates the binding for the current session.

- [ ] **Step 5: Run GREEN verification and commit**

Run `node --test tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect PASS. Commit `feat: calibrate Alibaba selling point field`.

---

### Task 3: 确定性共享图片分配

**Files:**
- Create: `src/shared-image-assignment.js`
- Create: `tests/shared-image-assignment.test.js`

**Interfaces:**
- Produces: `assignSharedProductImages({ variants, mainImages, marketingImages, fixedImages }): Assignment[]`
- `Assignment = { planId, files: [main, marketingA, marketingB, marketingC, fixedA, fixedB] }`
- Each image object contains `sha256`, `fileName`, `size`, `mimeType`.

- [ ] **Step 1: Write failing rotation tests**

Cover four main images, exactly three marketing images, more than three marketing images, two fixed images, stable ordering, and duplicate SHA-256 rejection.

```js
const result = assignSharedProductImages({
  variants: plans('plan-2', 'plan-3', 'plan-4', 'plan-5'),
  mainImages: images('m1', 'm2', 'm3', 'm4'),
  marketingImages: images('a', 'b', 'c', 'd'),
  fixedImages: images('fixed-2', 'fixed-cert'),
});
assert.deepEqual(result[1].files.map((item) => item.sha256), ['m2', 'b', 'c', 'd', 'fixed-2', 'fixed-cert']);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/shared-image-assignment.test.js`; expect module-not-found failure.

- [ ] **Step 3: Implement minimal assignment function**

Require exactly four mains, at least three marketing images and exactly two fixed images. For plan index `i`, select marketing indexes `i % n`, `(i + 1) % n`, `(i + 2) % n`. Reject duplicate digests within each six-image result and return new immutable arrays.

- [ ] **Step 4: Run GREEN verification and commit**

Run `node --test tests/shared-image-assignment.test.js`; expect PASS. Commit `feat: rotate shared listing images`.

---

### Task 4: 安全图片缓存与固定图配置

**Files:**
- Create: `src/photobank-cache.js`
- Create: `src/fixed-image-config.js`
- Modify: `src/server.js`
- Create: `tests/photobank-cache.test.js`
- Create: `tests/fixed-image-config.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `resolvePhotobankCache(rootDir, digests)` and `savePhotobankCacheEntry(rootDir, entry)`.
- Produces: `readFixedImageConfig(rootDir)` and `saveFixedImageConfig(rootDir, input)`.
- Produces: `POST /api/alibaba/photobank/cache/resolve`.
- Produces: `GET/POST /api/obsidian/fixed-images`.
- Extends upload input with `sha256`; successful results are cached.

- [ ] **Step 1: Write failing storage and route tests**

Assert cache identity uses lowercase 64-character SHA-256; file names are basename-only; `fileId` and HTTPS URL are both required; conflicting IDs are blocked; writes are atomic; credentials and Base64 are discarded. Fixed config must accept only exactly two explicit files, verify their current hashes, never enumerate parents, and mark missing/changed files unready.

```js
assert.deepEqual((await readFixedImageConfig(root)).slots.map((slot) => slot.name), ['通用图', '证书图']);
assert.doesNotMatch(await readFile(configPath, 'utf8'), /accessToken|base64/);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/photobank-cache.test.js tests/fixed-image-config.test.js tests/server.test.js`; expect missing modules/routes.

- [ ] **Step 3: Implement minimal atomic stores and routes**

Store cache at `data/photobank-cache.json` and fixed config at `data/fixed-images.json`. Use temporary files plus rename. The fixed route reads only the two submitted literal paths, computes hashes server-side, returns safe metadata, and never returns parent listings or bytes. The upload route writes a cache record only after complete Alibaba metadata returns.

- [ ] **Step 4: Run GREEN verification and commit**

Run focused tests; expect PASS. Commit `feat: persist reusable listing images`.

---

### Task 5: 共享图片区与一次上传

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/obsidian-publishing.js`
- Modify: `tests/obsidian-publishing-ui.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `imageContentKey(file, cryptoRef): Promise<string>`.
- Produces: `buildSharedImageAssignments(state): Assignment[]`.
- Consumes Tasks 3-4 assignment/cache APIs.

- [ ] **Step 1: Write failing UI state tests**

Assert state has four main slots, one marketing pool, two fixed slots, digest metadata and no per-plan file picker. Assert changing any source image clears previews and draft authority. Assert a deduplicated upload list contains each SHA-256 once even when referenced by four plans.

```js
assert.deepEqual(uniqueUploads(assignments).map((item) => item.sha256), [
  'm1', 'a', 'b', 'c', 'fixed-2', 'fixed-cert', 'm2', 'd', 'm3', 'm4',
]);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`; expect old per-plan picker behavior to fail the new assertions.

- [ ] **Step 3: Implement the shared panel**

Replace card-level six-file inputs with four main slots, one multi-file marketing pool, two fixed status rows and four generated six-image summaries. Hash selected browser files with Web Crypto. Load fixed-image metadata from the server. Keep raw File objects and object URLs in memory only.

- [ ] **Step 4: Implement cache-first deduplicated upload**

Resolve all unique digests before enabling upload. Upload only cache misses after one confirmation that lists the exact count. Send one file per unique digest; update every plan that references the returned mapping. Keep the existing no-auto-upload behavior and clear preview authority when assignments change.

- [ ] **Step 5: Run GREEN verification and commit**

Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`; expect PASS. Commit `feat: share images across Obsidian plans`.

---

### Task 6: 待办方案续跑与一个草稿验收

**Files:**
- Modify: `src/obsidian-task-store.js`
- Modify: `src/server.js`
- Modify: `public/obsidian-publishing.js`
- Modify: `tests/obsidian-task-store.test.js`
- Modify: `tests/server.test.js`
- Modify: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Produces: `listCompletedObsidianPlanIds(rootDir, identity)`.
- Produces: `pendingVariants(variants, completedPlanIds)`.
- Extends preview request with server-validated `planIds` and `sellingPointBinding`.

- [ ] **Step 1: Write failing resume and gate tests**

Assert history matching uses relative path, base plan and source product; only `draft_created` is completed. Assert `plan-2` is excluded, `plan-3..5` remain pending, completed IDs are rejected server-side, and missing/changed selling-point binding blocks preview and draft creation.

```js
assert.deepEqual(
  pendingVariants(allVariants, ['plan-2']).map((item) => item.id),
  ['plan-3', 'plan-4', 'plan-5'],
);
```

- [ ] **Step 2: Run RED verification**

Run `node --test tests/obsidian-task-store.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect failures for missing pending scope and binding gates.

- [ ] **Step 3: Implement server-side pending and binding validation**

Validate requested plan IDs against the batch, reject completed plans, ensure each requested plan has six complete image mappings, load the stored binding for the current category/language/version, and build previews only for pending plans. Store only non-secret binding metadata in the task; keep preview XML in memory.

- [ ] **Step 4: Render pending cards and real selling-point status**

Show plan 2 as completed with draft ID `1601933441594`. Show plan 3-5 with six-image summaries, Obsidian selling points, bound field ID/structure and preview fingerprints. Enable a draft button only after all gates pass.

- [ ] **Step 5: Run focused and full automated verification**

Run `node --test tests/obsidian-task-store.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`, then `git diff --check` and `npm test`; expect all PASS.

- [ ] **Step 6: Commit**

Commit `feat: resume verified Obsidian drafts` with all Task 6 files.

- [ ] **Step 7: Perform action-time live verification**

Restart the local service, verify `GET /api/health`, then stop for user authorization before any credential-bearing Alibaba request. After authorization, run only the selling-point diagnostic reads, configure/recover images, and generate the plan 3 preview. Show title, six images, selling-point field ID and fingerprint. Stop again for explicit plan 3 draft confirmation; create exactly one draft, read it back, and stop for Alibaba后台核对. Never call `schema.add`.

## Self-Review

- Spec coverage: real selling-point calibration, false-positive prevention, four main slots, shared marketing rotation, two fixed images, SHA-256 reuse, one upload per content hash, completed-plan skip, one-draft stop and formal-publish prohibition are covered by Tasks 1-6.
- Placeholder scan: no TBD/TODO, unspecified error handling or deferred implementation remains.
- Interface consistency: every image uses lowercase `sha256`, normalized uploads use `fileId/photobankUrl`, preview scope uses `planIds`, and all selling-point operations use one `SellingPointBinding` structure.
