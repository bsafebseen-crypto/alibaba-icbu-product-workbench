# Obsidian 图片银行恢复与安全续跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Obsidian 上品模块在服务重启后通过图片 SHA-256 缓存或用户确认的图片银行候选恢复映射，并只为尚未创建草稿的方案重新生成预览。

**Architecture:** 浏览器为用户主动选择的图片计算 SHA-256；服务端以原子 JSON 文件保存安全的 `sha256 -> fileId/url` 映射。缓存未命中时，用户主动调用只读 `alibaba.icbu.photobank.list`，页面只把同名同大小记录显示为候选并要求确认，绝不自动认定内容相同。Obsidian 预览只包含没有历史草稿的方案，服务端根据持久化历史再次校验，旧预览会话始终不可复用。

**Tech Stack:** Node.js 20+、原生 ESM、Node HTTP 服务、浏览器 Web Crypto、Node 内置测试运行器，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-26-obsidian-photobank-resume-design.md`

## Global Constraints

- 不保存图片 Base64、图片字节、本地绝对路径、App Secret、Access Token、Refresh Token、完整 Schema XML 或预览 XML。
- `photobank.list` 是用户主动启动的只读查询；`photobank.upload` 继续要求明确确认。
- `schema.add.draft` 继续绑定当前预览指纹并逐商品确认。
- `schema.add` 正式发布继续禁止。
- 旧预览会话在进程重启后继续失效，不从磁盘恢复。
- 修改功能先写失败测试，做最小实现，再运行全量 `npm test`。
- 不引入框架或第三方依赖。

---

### Task 1: 安全图片映射缓存

**Files:**
- Create: `src/photobank-cache.js`
- Create: `tests/photobank-cache.test.js`

**Interfaces:**
- Produces: `normalizeImageDigest(value): string`
- Produces: `resolvePhotobankCache(rootDir, digests): Promise<Record<string, SafeUpload>>`
- Produces: `savePhotobankCacheEntry(rootDir, entry): Promise<SafeUpload>`
- `SafeUpload = { sha256, fileName, size, mimeType, fileId, photobankUrl, source, verifiedAt }`

- [ ] **Step 1: Write failing cache tests**

Test that a valid entry round-trips, only the basename is stored, credentials/Base64/absolute paths are absent, malformed digests and non-HTTPS URLs are rejected, corrupt cache entries are ignored, and the same digest with a different `fileId` is blocked as a conflict.

Core assertion:

```js
await savePhotobankCacheEntry(root, {
  sha256: 'a'.repeat(64), fileName: 'C:\\secret\\1.jpg', size: 65981,
  mimeType: 'image/jpeg', fileId: 'file-1', photobankUrl: 'https://img/1.jpg',
  source: 'upload', accessToken: 'must-not-persist', dataUrl: 'data:image/jpeg;base64,AAA',
});
assert.deepEqual(Object.keys(await resolvePhotobankCache(root, ['a'.repeat(64)])), ['a'.repeat(64)]);
assert.doesNotMatch(await readFile(cachePath, 'utf8'), /must-not-persist|base64|secret/);
```

- [ ] **Step 2: Verify the focused test fails**

Run `node --test tests/photobank-cache.test.js`; expect module-not-found failure.

- [ ] **Step 3: Implement the minimal cache**

Use `data/photobank-cache.json`, basename-only file names, lowercase 64-character SHA-256 keys, allowed MIME types, numeric sizes, complete `fileId` plus HTTPS URL, source restricted to `upload` or `photobank-list`, and temporary-file-plus-rename writes. Example validator:

```js
export function normalizeImageDigest(value) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('图片 SHA-256 无效');
  return digest;
}
```

- [ ] **Step 4: Verify the focused test passes**

Run `node --test tests/photobank-cache.test.js`; expect PASS.

- [ ] **Step 5: Commit**

Stage the two Task 1 files and commit `feat: persist safe photobank mappings`.

---

### Task 2: 浏览器 SHA-256 与缓存恢复路由

**Files:**
- Modify: `public/obsidian-publishing.js`
- Modify: `src/server.js`
- Modify: `tests/obsidian-publishing-ui.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes Task 1 cache functions.
- Produces: `imageContentKey(file, cryptoRef): Promise<string>`.
- Produces: `POST /api/alibaba/photobank/cache/resolve` with `{ images: [{ sha256, fileName, size, mimeType }] }`.
- Extends upload body with `image.sha256`; successful uploads are cached before responding.

- [ ] **Step 1: Write failing browser and route tests**

Test that same bytes produce the same digest, same metadata with different bytes produces different digests, cache resolve returns only requested safe mappings, invalid digests are rejected, and a successful upload invokes `savePhotobankCacheEntry` without persisting the data URL.

Digest implementation expected by the test:

```js
export async function imageContentKey(file, cryptoRef = globalThis.crypto) {
  const digest = await cryptoRef.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Verify focused tests fail**

Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`; expect missing helper/route failures.

- [ ] **Step 3: Implement digest-backed lookup**

Compute a digest map after file selection, keep file objects in memory only, and replace metadata-based `imageFileKey` lookup inside the Obsidian flow. Add strict count/MIME/digest validation to the resolve route. Inject cache functions through `createServer(options)` for isolated tests. Save an upload mapping only after Alibaba returned both `fileId` and `photobankUrl`.

- [ ] **Step 4: Verify focused tests pass**

Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`; expect PASS.

- [ ] **Step 5: Commit**

Stage Task 2 files and commit `feat: restore uploads by image digest`.

---

### Task 3: 图片银行只读列表与人工候选绑定

**Files:**
- Modify: `src/alibaba-client.js`
- Modify: `src/server.js`
- Modify: `public/obsidian-publishing.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `tests/alibaba-client.test.js`
- Modify: `tests/server.test.js`
- Modify: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Produces: `listAlibabaPhotos(config, query, fetchImpl, timestamp): Promise<{ images, traceId, page }>`.
- Produces: `findPhotobankCandidates(localImages, remoteImages): Record<sha256, Candidate[]>`.
- Produces: `POST /api/alibaba/photobank/list`.
- Produces: `POST /api/alibaba/photobank/cache/confirm` for user-confirmed candidates.

- [ ] **Step 1: Write failing list and candidate tests**

Use the official contract: request fields `current_page`, `page_size`, `location_type`, optional `group_id`, and `extra_context`; response fields `id`, `url`, `file_name`, `file_size`, `gmt_modified`, and `trace_id`. Assert page >= 1, page size 1..100, location in `ALL_GROUP/SUB_GROUP/UNGROUP`, safe HTTPS URLs, and normalized output:

```js
assert.deepEqual(result.images, [{
  fileId: 'image-1', photobankUrl: 'https://img/1.jpg',
  fileName: '1.jpg', size: 65981, modifiedAt: '2026-08-25',
}]);
```

Test that exact file name plus size creates a candidate but never an accepted upload, while same-name different-size records produce no candidate. Test that confirmation requires `confirmed: true` and responses/logs do not expose raw Alibaba payloads or credentials.

- [ ] **Step 2: Verify focused tests fail**

Run `node --test tests/alibaba-client.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect missing functions/routes failures.

- [ ] **Step 3: Implement the bounded read-only client**

Call `callAlibabaApi(config, 'alibaba.icbu.photobank.list', params, fetchImpl, timestamp)`. Normalize only required candidate metadata. Return at most one bounded page per user click; do not add automatic pagination or background polling.

- [ ] **Step 4: Implement explicit candidate confirmation**

Add `查询已上传图片（只读）`. Clicking it queries one bounded page. Show candidate name, size, modified time, `fileId`, and URL. Before binding, `window.confirm` must state that Alibaba provides no content hash and the user is confirming the candidate is the same image. Only confirmed candidates call the cache-confirm route with `source: photobank-list`; no Alibaba write occurs.

- [ ] **Step 5: Verify focused tests pass**

Run `node --test tests/alibaba-client.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect PASS.

- [ ] **Step 6: Commit**

Stage Task 3 files and commit `feat: recover photobank candidates safely`.

---

### Task 4: 仅续跑尚未创建草稿的方案

**Files:**
- Modify: `src/obsidian-task-store.js`
- Modify: `src/server.js`
- Modify: `public/obsidian-publishing.js`
- Modify: `tests/obsidian-task-store.test.js`
- Modify: `tests/server.test.js`
- Modify: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Produces: `listCompletedObsidianPlanIds(rootDir, identity): Promise<string[]>`.
- Produces: `pendingVariants(variants, completedPlanIds): Variant[]`.
- Extends preview request with `planIds`, validated server-side.

- [ ] **Step 1: Write failing resume tests**

Assert `pendingVariants` removes `plan-2` when it has `draft_created`, but does not remove `preview_ready`, `failed`, `submitting`, or `result_unknown`. Store history must match all of `relativePath`, `basePlanId`, and `sourceProductId`. The preview route must reject a completed plan with 409 and build only requested pending plans.

Core assertion:

```js
assert.deepEqual(
  pendingVariants([{ id: 'plan-2' }, { id: 'plan-3' }, { id: 'plan-4' }, { id: 'plan-5' }], ['plan-2'])
    .map((item) => item.id),
  ['plan-3', 'plan-4', 'plan-5'],
);
```

- [ ] **Step 2: Verify focused tests fail**

Run `node --test tests/obsidian-task-store.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect missing history filter and plan validation failures.

- [ ] **Step 3: Enforce pending scope on the server**

Deduplicate `body.planIds`, verify every ID belongs to `createObsidianVariants(batch, basePlanId)`, read completed IDs using the full batch identity, reject completed IDs, and build previews/tasks only for requested pending variants. Preserve existing in-memory `previewSessions`, fingerprint matching, `submitting`, and `result_unknown` gates.

- [ ] **Step 4: Render completed history and pending selectors**

Match saved drafts on relative path, base plan, and source product. Render completed plans read-only with draft ID; render image selectors only for pending plans. `buildPreviewRequest` sends the pending plan IDs. If none remain, disable image and preview actions.

- [ ] **Step 5: Verify focused tests pass**

Run `node --test tests/obsidian-task-store.test.js tests/server.test.js tests/obsidian-publishing-ui.test.js`; expect PASS.

- [ ] **Step 6: Commit**

Stage Task 4 files and commit `feat: resume pending Obsidian drafts`.

---

### Task 5: 全量验证与首个续跑草稿验收

**Files:**
- Modify only defects directly caused by Tasks 1-4.

**Interfaces:**
- Consumes all preceding tasks.
- Produces a verified workbench ready for one user-confirmed `plan-3` draft.

- [ ] **Step 1: Run automated verification**

Run `git diff --check` and `npm test`; expect no whitespace errors and all tests PASS.

- [ ] **Step 2: Restart and health-check**

Run the service on `127.0.0.1:54025` and request `GET /api/health`; expect `{ "ok": true }` and no public listener.

- [ ] **Step 3: Exercise recovery without writes**

Load `2026-08-25/反光T恤4.md`, bind mother product `1601933369105`, verify `plan-2` is completed with draft ID `1601933441594`, reselect images for `plan-3` through `plan-5`, resolve cache, then run the read-only list only after user action. Present same-name-and-size candidates for confirmation and upload only actual misses after a separate confirmation. Generate fresh previews and verify title, selling points, 5 FAQ, 10 attributes, and 6 complete image records.

- [ ] **Step 4: Stop for action-time confirmation of one item**

Show the enabled `plan-3` title, six-image readiness, and preview fingerprint. Only after the user explicitly confirms that individual item, call the existing draft route once. Expect one new `draftProductId`, no automatic retry, and no `schema.add` call.

- [ ] **Step 5: Read back the new draft**

Use the existing read-only verification action. Expect semantic match for title, selling points, 5 FAQ, 10 custom attributes, and 6 images; show trace ID without raw XML.

- [ ] **Step 6: Final regression**

Run `npm test`, `git status --short`, and `git log -5 --oneline`; expect all tests PASS and no uncommitted implementation changes.

## Self-Review

- Spec coverage: SHA-256 identity, atomic cache, bounded read-only list, manual candidate confirmation, upload caching, restart-safe preview regeneration, completed-plan skip, existing draft gates, and formal publish prohibition are covered by Tasks 1-5.
- Placeholder scan: no TBD/TODO or undefined implementation action remains.
- Interface consistency: every layer uses lowercase 64-character `sha256`, normalized `fileId` and `photobankUrl`, and `planIds` for pending preview scope.
