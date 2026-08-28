# Obsidian Body-First Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench parse five complete Alibaba listing plans directly from human-readable Obsidian Markdown so the machine JSON block is optional.

**Architecture:** Keep `src/obsidian-listing.js` as the filesystem and parsing boundary. Add a deterministic body parser that produces the existing validated batch shape, use a legacy machine block only for a compatible batch ID and drift warnings, and expose warnings through the existing batch API and UI without changing Alibaba safety gates.

**Tech Stack:** Node.js ES modules, built-in `node:test`, browser JavaScript, existing local HTTP server

**Spec:** `docs/superpowers/specs/2026-08-28-obsidian-body-first-import-design.md`

## Global Constraints

- Every Markdown contains exactly five plans; the user manually publishes one and the workbench prepares the other four.
- Title, selling points, custom attributes, and FAQs always come from the human-readable body.
- Parsing is deterministic and local; do not call AI or add dependencies.
- Keep the 2 MiB limit, fixed-root enforcement, realpath containment, and symlink exclusion.
- Do not weaken preview fingerprints, per-draft confirmation, selling-point binding, or the formal-publish lock.
- Do not modify real Obsidian Markdown or call Alibaba draft/publish APIs during acceptance.

---

### Task 1: Parse Complete Five-Plan Markdown Bodies

**Files:**
- Modify: `src/obsidian-listing.js:13-84`
- Modify: `src/obsidian-listing.js:221-241`
- Test: `tests/obsidian-listing.test.js:1-165`

**Interfaces:**
- Consumes: `markdown: string` and source metadata `{ relativePath, fileName, modifiedAt, size }`.
- Produces: `parseListingBody(markdown, source, legacyPayload?)`, returning the existing validated batch shape.
- Preserves: strict `extractListingPayload(markdown)` for legacy callers and tests.

- [ ] **Step 1: Add a body-only fixture helper and failing success tests**

Add this helper to `tests/obsidian-listing.test.js` and use it without appending a machine block:

```js
function bodyMarkdown({ bullet = '•', missing = '' } = {}) {
  const plans = Array.from({ length: 5 }, (_, planIndex) => {
    const number = planIndex + 1;
    const attributes = Array.from({ length: 10 }, (_, index) => (
      `${index + 1}. Attribute ${index + 1}: Plan ${number} Value ${index + 1}`
    ));
    const faqs = Array.from({ length: 5 }, (_, index) => [
      `${index + 1}. **Q:** Plan ${number} Question ${index + 1}?`,
      `   **A:** Plan ${number} Answer ${index + 1}.`,
      `   **埋入关键词:** keyword ${index + 1}`,
    ].join('\n'));
    const points = Array.from({ length: 5 }, (_, index) => (
      `${bullet} Plan ${number} Point ${index + 1}: Body selling point ${index + 1}.`
    ));
    return [
      `## 方案 ${number}：正文方案`, '',
      missing === `title-${number}` ? '' : `- **Title:** Reflective Product Body Plan ${number}`, '',
      '### 10 Custom Attributes', '', ...attributes, '',
      '### 5 FAQs', '', ...faqs, '',
      '#### Selling Points', '', ...points,
    ].join('\n');
  });
  return ['# Reflective Product 国际站发品方案', '', ...plans].join('\n');
}

test('readObsidianBatch parses five complete plans without a machine block', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-'));
  await writeFile(path.join(root, 'body.md'), bodyMarkdown(), 'utf8');
  const batch = await readObsidianBatch(root, 'body.md');
  assert.equal(batch.batchName, 'Reflective Product');
  assert.equal(batch.plans.length, 5);
  assert.equal(batch.plans[3].title, 'Reflective Product Body Plan 4');
  assert.equal(batch.plans[3].customAttributes.length, 10);
  assert.equal(batch.plans[3].faqs.length, 5);
  assert.equal(batch.plans[3].sellingPoints.split('\n').length, 5);
});
```

Add a loop over `['•', '-', '*']` that writes a body fixture, reads it, and asserts `sellingPoints` does not match `/^[•*-]/m`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
npm test -- --test-name-pattern="without a machine block|body parser strips"
```

Expected: FAIL with `缺少阿里发品机器数据块`.

- [ ] **Step 3: Implement the minimal body parser**

Import `createHash` from `node:crypto`. Add `sectionBetween`, `parseBodyPlan`, and this public entry point to `src/obsidian-listing.js`:

```js
export function parseListingBody(markdown, source = {}, legacyPayload = null) {
  const machineStart = markdown.indexOf(START_MARKER);
  const humanMarkdown = machineStart >= 0 ? markdown.slice(0, machineStart) : markdown;
  const matches = [...humanMarkdown.matchAll(/^##\s+方案\s+([1-5])(?:[：:].*)?$/gm)];
  const numbers = matches.map((match) => Number(match[1]));
  if (matches.length !== 5 || numbers.join(',') !== '1,2,3,4,5') {
    throw new Error('方案编号必须恰好为 1、2、3、4、5');
  }
  const plans = matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? humanMarkdown.length;
    return parseBodyPlan(humanMarkdown.slice(match.index, end), Number(match[1]));
  });
  const heading = /^#\s+(.+?)(?:\s+国际站发品方案)?\s*$/m.exec(humanMarkdown)?.[1]?.trim();
  const fallbackName = path.parse(source.fileName || 'Obsidian Listing').name;
  const pathKey = String(source.relativePath || source.fileName || fallbackName).replaceAll('\\', '/');
  const fallbackId = `obsidian-${createHash('sha256').update(pathKey).digest('hex').slice(0, 16)}`;
  return validateListingBatch({
    schemaVersion: OBSIDIAN_LISTING_SCHEMA_VERSION,
    batchId: legacyPayload?.batchId || fallbackId,
    batchName: heading || fallbackName,
    plans,
  }, source);
}
```

`parseBodyPlan(section, planNumber)` must:

- extract one non-empty `- **Title:**` line or throw `方案 N 缺少 Title`;
- parse exactly ten numbered `Key: Value` rows between `### 10 Custom Attributes` and the next level 2/3 heading;
- parse exactly five numbered Q/A pairs between `### 5 FAQs` and the next level 2/3 heading;
- parse exactly five `•`, `-`, or `*` bullets below `#### Selling Points` until the next heading or `selling-points:end` marker;
- return `{ id: 'plan-N', title, sellingPoints: points.join('\n'), faqs, customAttributes }`.

Replace the final `readObsidianBatch` return with `parseListingBody(markdown, source)`; Task 2 adds optional legacy metadata.

- [ ] **Step 4: Add failing precision-error tests**

Add one test per error and assert exact plan context:

```js
test('body parser reports the exact plan with a missing title', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-body-error-'));
  await writeFile(path.join(root, 'body.md'), bodyMarkdown({ missing: 'title-3' }), 'utf8');
  await assert.rejects(() => readObsidianBatch(root, 'body.md'), /方案 3 缺少 Title/);
});
```

Also cover: duplicate/missing plan number, nine attributes, FAQ 5 missing Answer, and four selling points. Expected messages must name the plan, required count, and actual count.

- [ ] **Step 5: Run the parser test file**

Run `node --test tests/obsidian-listing.test.js`.

Expected: all parser tests PASS, including existing traversal and file-type safeguards.

- [ ] **Step 6: Commit the body parser**

```powershell
git add -- src/obsidian-listing.js tests/obsidian-listing.test.js
git commit -m "feat: parse Alibaba listings from Obsidian body"
```

---

### Task 2: Make Legacy Machine Blocks Optional and Non-Authoritative

**Files:**
- Modify: `src/obsidian-listing.js:13-31`
- Modify: `src/obsidian-listing.js:185-241`
- Modify: `public/obsidian-publishing.js:270-286`
- Modify: `public/obsidian-publishing.js:475-520`
- Test: `tests/obsidian-listing.test.js`
- Test: `tests/obsidian-publishing-ui.test.js`

**Interfaces:**
- Produces: internal `readLegacyPayload(markdown) -> { payload: object|null, warnings: string[] }`.
- Produces: `batch.source.warnings: string[]` and additive `warnings` on directory entries.
- Body fields always win; a valid legacy `batchId` is retained for old draft-record compatibility.

- [ ] **Step 1: Write failing compatibility tests**

Add tests for a stale but valid block and malformed JSON:

```js
test('body content wins when a legacy machine block is stale', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-legacy-drift-'));
  const legacy = validPayload();
  legacy.plans[0].title = 'Stale machine title';
  const machine = `<!-- alibaba-listing-batch:start -->\n\`\`\`json\n${JSON.stringify(legacy)}\n\`\`\`\n<!-- alibaba-listing-batch:end -->`;
  await writeFile(path.join(root, 'body.md'), `${bodyMarkdown()}\n${machine}`, 'utf8');
  const batch = await readObsidianBatch(root, 'body.md');
  assert.equal(batch.batchId, legacy.batchId);
  assert.equal(batch.plans[0].title, 'Reflective Product Body Plan 1');
  assert.deepEqual(batch.source.warnings, ['机器数据块内容已过期，当前按正文读取']);
});
```

The malformed test appends `{invalid` inside the marked JSON block and asserts the valid body loads with a warning matching `/机器数据块无效/`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run `npm test -- --test-name-pattern="legacy machine|machine JSON"`.

Expected: FAIL because current legacy extraction blocks or returns no warning.

- [ ] **Step 3: Implement optional legacy inspection**

Add:

```js
function readLegacyPayload(markdown) {
  if (!markdown.includes(START_MARKER) && !markdown.includes(END_MARKER)) {
    return { payload: null, warnings: [] };
  }
  try {
    return { payload: extractListingPayload(markdown), warnings: [] };
  } catch (error) {
    return { payload: null, warnings: [`机器数据块无效，当前按正文读取：${error.message}`] };
  }
}
```

In `readObsidianBatch`, inspect legacy data, parse the body with a valid legacy payload, compare the legacy plans against the body-derived normalized plans, and append exactly `机器数据块内容已过期，当前按正文读取` on drift. Pass warnings through `source`. In `listObsidianBatches`, add:

```js
warnings: Array.isArray(batch.source.warnings) ? [...batch.source.warnings] : [],
```

A malformed or unsupported block must not rescue an invalid body and must not override any body field.

- [ ] **Step 4: Write and run a failing UI formatter test**

In `tests/obsidian-publishing-ui.test.js`, import `formatBatchLoadStatus` and assert:

```js
assert.deepEqual(
  formatBatchLoadStatus({ source: { warnings: ['机器数据块内容已过期，当前按正文读取'] } }),
  { message: '批次校验通过。机器数据块内容已过期，当前按正文读取', tone: 'warning' },
);
```

Run `node --test tests/obsidian-publishing-ui.test.js`.

Expected: FAIL because the formatter does not exist.

- [ ] **Step 5: Implement warning presentation without disabling the batch**

Export from `public/obsidian-publishing.js`:

```js
export function formatBatchLoadStatus(batch) {
  const warnings = Array.isArray(batch?.source?.warnings) ? batch.source.warnings.filter(Boolean) : [];
  return warnings.length
    ? { message: `批次校验通过。${warnings.join('；')}`, tone: 'warning' }
    : { message: '批次校验通过。请选择已经手动发布的母商品方案。', tone: 'success' };
}
```

Use it in `loadSelectedBatch()`. Do not disable an option merely because it has warnings.

- [ ] **Step 6: Run parser, UI, and server tests**

Run:

```powershell
node --test tests/obsidian-listing.test.js tests/obsidian-publishing-ui.test.js tests/server.test.js
```

Expected: all selected tests PASS; API changes are additive only.

- [ ] **Step 7: Commit compatibility behavior**

```powershell
git add -- src/obsidian-listing.js public/obsidian-publishing.js tests/obsidian-listing.test.js tests/obsidian-publishing-ui.test.js
git commit -m "feat: make Obsidian machine blocks optional"
```

---

### Task 3: Prove Real-File Acceptance and Preserve Safety Gates

**Files:**
- Verify read-only: `C:\obsidian\obsidian\国际站发品\2026-08-27\反光布贴.md`
- Modify only after a reproduced defect: `src/obsidian-listing.js`
- Add a regression only after a reproduced defect: `tests/obsidian-listing.test.js`

**Interfaces:**
- Consumes: `readObsidianBatch(DEFAULT_OBSIDIAN_ROOT, '2026-08-27/反光布贴.md')`.
- Produces: evidence for five plans, fifty attributes, twenty-five FAQs, and twenty-five selling points.

- [ ] **Step 1: Run the real-file read-only acceptance script**

Run:

```powershell
node --input-type=module -e "import { readObsidianBatch } from './src/obsidian-listing.js'; const batch = await readObsidianBatch('C:\\obsidian\\obsidian\\国际站发品', '2026-08-27/反光布贴.md'); const result = { batchId: batch.batchId, batchName: batch.batchName, plans: batch.plans.length, attributes: batch.plans.reduce((n,p)=>n+p.customAttributes.length,0), faqs: batch.plans.reduce((n,p)=>n+p.faqs.length,0), sellingPoints: batch.plans.reduce((n,p)=>n+p.sellingPoints.split('\\n').length,0), warnings: batch.source.warnings }; console.log(JSON.stringify(result,null,2));"
```

Expected: batch name `反光布贴`, non-empty stable `batchId`, 5 plans, 50 attributes, 25 FAQs, 25 selling points, and no warnings.

- [ ] **Step 2: Verify directory discovery**

Run a read-only `listObsidianBatches()` script and filter `2026-08-27/反光布贴.md`.

Expected: `valid: true`, `error: ''`, and no `缺少阿里发品机器数据块` text.

- [ ] **Step 3: Run the complete suite**

Run `npm test`.

Expected: all tests PASS, including preview fingerprints, replacement authorization, read-only verification, and formal-publish lock coverage.

- [ ] **Step 4: Check the diff and worktree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files and existing untracked `data/`. Never stage `data/`.

- [ ] **Step 5: Restart and inspect the local UI without Alibaba writes**

Resolve the exact listener on `127.0.0.1:54025`, verify it is `node.exe`, stop only that PID, and restart `node src/server.js` hidden from this worktree. Check `/api/health`, reload the existing workbench tab, and verify:

- `反光布贴 · 2026-08-27/反光布贴.md` is enabled;
- the newest valid body batch auto-loads;
- all five plans are visible and selectable;
- no Alibaba source-product, image-upload, draft-create, or publish action occurs.

- [ ] **Step 6: Commit only if acceptance exposed a defect**

If acceptance fails, first add the smallest regression test, then apply the smallest fix, rerun all verification, and commit:

```powershell
git add -- src/obsidian-listing.js tests/obsidian-listing.test.js
git commit -m "fix: accept generated Obsidian listing bodies"
```

If acceptance passes without changes, do not create an empty commit.

