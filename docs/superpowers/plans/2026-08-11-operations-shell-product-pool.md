# Operations Shell and Product Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local listing tool into a restrained international-station operations console with a real overview page and a searchable local product pool built from saved task JSON.

**Architecture:** Keep the existing dependency-free browser application and Node HTTP server. Add read-only task repository APIs, isolate product-pool derivation in a pure browser module, and let the existing app controller render the overview, table, filters, pagination, and detail drawer without changing Alibaba write behavior.

**Tech Stack:** Node.js 20+, browser ES modules, HTML/CSS, Node built-in test runner, existing `fast-xml-parser` and `exceljs` dependencies only.

## Global Constraints

- Do not add Alibaba draft, product-update, or publish API calls.
- Keep photo-bank upload behind the existing explicit confirmation dialog.
- Never return or render App Secret, Access Token, API Key, Base64 image data, or raw credentials from task APIs.
- Use real saved-task data only; do not invent exposure, click, inquiry, search-volume, or sales metrics.
- Keep the existing auto-listing, AI generation, XLSX import, photo-bank upload, and Schema preview behavior working.
- Retain the collapsible left navigation; do not replace it with the reference product's branding or copy.
- Do not initialize, commit, or push a Git repository; repository creation remains deferred by the user.

---

### Task 1: Read-Only Local Task Repository

**Files:**
- Modify: `src/task-store.js`
- Modify: `src/server.js`
- Modify: `tests/task-store.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `listTasks(rootDir): Promise<{ tasks: TaskSummary[], invalid: InvalidTask[] }>`.
- Produces: `readTask(rootDir, id): Promise<object>`.
- Produces: `GET /api/tasks` and `GET /api/tasks/:id`.
- `TaskSummary` fields: `id`, `createdAt`, `updatedAt`, `status`, `sourceProductId`, `mode`, `products`, `imageUploadCount`, `previewCount`.

- [ ] **Step 1: Write failing repository tests**

Create two saved fixtures and one malformed JSON file inside a temporary `data/tasks` directory, then assert newest-first summaries and isolated corruption:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { listTasks, readTask } from '../src/task-store.js';

test('listTasks returns safe newest-first summaries and isolates malformed files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'icbu-pool-'));
  const taskDir = path.join(rootDir, 'data', 'tasks');
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, '20260810-old.json'), JSON.stringify({
    id: '20260810-old', createdAt: '2026-08-10T01:00:00.000Z', status: 'prepared',
    source: { sourceProductId: '100', photobankUploads: { 'main:0': { fileId: 'm0', photobankUrl: 'https://img/m0.jpg' } } },
    generation: { mode: 'template', apiKey: 'must-not-leak' },
    products: [{ index: 1, title: 'Old', preview: { changedFields: ['title'] } }],
  }));
  await writeFile(path.join(taskDir, '20260811-new.json'), JSON.stringify({
    id: '20260811-new', createdAt: '2026-08-11T01:00:00.000Z', status: 'prepared',
    source: { sourceProductId: '200' }, generation: { mode: 'template' },
    products: [{ index: 1, title: 'New' }],
  }));
  await writeFile(path.join(taskDir, 'broken.json'), '{broken');

  const result = await listTasks(rootDir);
  assert.deepEqual(result.tasks.map((task) => task.id), ['20260811-new', '20260810-old']);
  assert.equal(result.tasks[1].imageUploadCount, 1);
  assert.equal(result.tasks[1].previewCount, 1);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(result.invalid, [{ fileName: 'broken.json', error: '任务文件损坏' }]);
  assert.equal((await readTask(rootDir, '20260811-new')).products[0].title, 'New');
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `node --test tests/task-store.test.js`

Expected: FAIL because `listTasks` and `readTask` are not exported.

- [ ] **Step 3: Implement safe list and read operations**

Use `readdir`, `readFile`, and `stat` from `node:fs/promises`. Validate task IDs with `/^[A-Za-z0-9-]+$/`, resolve the final path under `data/tasks`, parse each `.json` independently, and derive summaries without returning the raw task. Use `sanitizeTaskForStorage` again before returning a single task as defense in depth.

```js
function summarizeTask(task, modifiedAt) {
  const products = Array.isArray(task.products) ? task.products : [];
  return {
    id: String(task.id || ''),
    createdAt: String(task.createdAt || ''),
    updatedAt: modifiedAt.toISOString(),
    status: String(task.status || 'prepared'),
    sourceProductId: String(task.source?.sourceProductId || ''),
    mode: String(task.generation?.mode || 'manual'),
    products: products.map((product) => {
      const assignment = product.imageAssignment;
      const requiredKeys = [
        `main:${assignment?.mainImageIndex}`,
        ...(assignment?.auxiliaryImageIndexes || []).map((index) => `auxiliary:${index}`),
      ];
      const uploads = task.source?.photobankUploads || {};
      return {
        index: Number(product.index || 0),
        title: String(product.title || ''),
        faqCount: Array.isArray(product.faqItems) ? product.faqItems.length : 0,
        customAttributeCount: Array.isArray(product.customAttributes) ? product.customAttributes.length : 0,
        imageReady: requiredKeys.length === 6 && requiredKeys.every((key) => (
          uploads[key]?.fileId && uploads[key]?.photobankUrl
        )),
        hasPreview: Boolean(product.preview?.previewXml),
        previewFields: Array.isArray(product.preview?.changedFields) ? product.preview.changedFields : [],
      };
    }),
    imageUploadCount: Object.keys(task.source?.photobankUploads || {}).length,
    previewCount: products.filter((product) => product.preview?.previewXml).length,
  };
}
```

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `node --test tests/task-store.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing HTTP tests**

Inject `listTasks` and `readTask` through `createServer(options)`, request both routes, and assert safe JSON plus a Chinese 404 for a missing ID:

```js
test('GET /api/tasks and /api/tasks/:id expose read-only safe task data', async () => {
  await withServer(async (baseUrl) => {
    const listResponse = await fetch(`${baseUrl}/api/tasks`);
    assert.deepEqual(await listResponse.json(), { tasks: [{ id: 'task-1' }], invalid: [] });
    const detailResponse = await fetch(`${baseUrl}/api/tasks/task-1`);
    const detailText = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.doesNotMatch(detailText, /secret|data:image/);
  }, {
    listTasks: async () => ({ tasks: [{ id: 'task-1' }], invalid: [] }),
    readTask: async () => ({ id: 'task-1', products: [] }),
  });
});
```

- [ ] **Step 6: Add the two GET routes and verify**

Register exact-match `GET /api/tasks` before the parameterized route, decode the final path segment, and map `ENOENT` to HTTP 404 with `任务不存在`.

Run: `node --test tests/server.test.js`

Expected: PASS.

---

### Task 2: Pure Product-Pool and Dashboard Model

**Files:**
- Create: `public/product-pool.js`
- Create: `tests/product-pool.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: safe task summaries from `GET /api/tasks`.
- Produces: `buildProductRows(tasks): ProductRow[]`.
- Produces: `filterProductRows(rows, query, stage): ProductRow[]`.
- Produces: `sortProductRows(rows, sortKey, direction): ProductRow[]`.
- Produces: `summarizeDashboard(tasks, rows): DashboardSummary`.

- [ ] **Step 1: Write failing model tests with literal expected rows**

```js
import {
  buildProductRows, filterProductRows, sortProductRows, summarizeDashboard,
} from '../public/product-pool.js';

test('buildProductRows expands task products and derives actionable stages', () => {
  const rows = buildProductRows([{
    id: 'task-1', createdAt: '2026-08-11T01:00:00.000Z', sourceProductId: '1601915922577',
    imageUploadCount: 6, previewCount: 1,
    products: [
      { index: 1, title: 'Ready Vest', faqCount: 5, customAttributeCount: 5, imageReady: true, hasPreview: true, previewFields: ['images'] },
      { index: 2, title: '', faqCount: 3, customAttributeCount: 0, imageReady: false, hasPreview: false, previewFields: [] },
    ],
  }]);
  assert.equal(rows[0].stage, 'preview-ready');
  assert.deepEqual(rows[0].issues, []);
  assert.equal(rows[1].stage, 'needs-content');
  assert.deepEqual(rows[1].issues, ['缺少标题', 'FAQ 不足 5 组', '缺少自定义属性', '尚未生成完整预览']);
});

test('filter, sort, and dashboard summary operate on derived rows', () => {
  const rows = [
    { taskId: 'b', title: 'Traffic Vest', stage: 'needs-content', updatedAt: '2026-08-10T00:00:00Z' },
    { taskId: 'a', title: 'Warehouse Vest', stage: 'preview-ready', updatedAt: '2026-08-11T00:00:00Z' },
  ];
  assert.deepEqual(filterProductRows(rows, 'warehouse', 'all').map((row) => row.taskId), ['a']);
  assert.deepEqual(sortProductRows(rows, 'updatedAt', 'desc').map((row) => row.taskId), ['a', 'b']);
  assert.deepEqual(summarizeDashboard([{ id: 'a' }, { id: 'b' }], rows), {
    batchCount: 2, productCount: 2, readyCount: 1, needsAttentionCount: 1,
  });
});
```

- [ ] **Step 2: Run model tests and verify RED**

Run: `node --test tests/product-pool.test.js`

Expected: FAIL because `public/product-pool.js` does not exist.

- [ ] **Step 3: Implement only the tested derivation rules**

Derive issues from title, FAQ count, custom attribute count, the per-product `imageReady` flag, and preview fields. Return new arrays from filtering and sorting so API data remains immutable. Normalize all searchable text with `toLocaleLowerCase()`.

- [ ] **Step 4: Run model tests and verify GREEN**

Run: `node --test tests/product-pool.test.js`

Expected: PASS.

- [ ] **Step 5: Serve the new browser module**

Add `'/product-pool.js': ['product-pool.js', 'text/javascript; charset=utf-8']` to the static file map and extend the static-page server test to request it successfully.

Run: `node --test tests/server.test.js`

Expected: PASS.

---

### Task 3: Operations Shell, Navigation, and Status Bar

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces module IDs: `dashboard`, `auto-listing`, `product-pool`, `keywords`, `ai-settings`, `alibaba-settings`.
- Produces top-bar IDs: `top-local-state`, `top-alibaba-state`, `top-batch-state`, `top-last-saved`.
- Consumes existing `switchModule(moduleName)` and current service/profile state.

- [ ] **Step 1: Write failing shell markup assertions**

Extend `GET /` assertions:

```js
assert.match(html, /data-module="dashboard"/);
assert.match(html, /data-module="product-pool"/);
assert.match(html, /id="operations-topbar"/);
assert.match(html, /id="top-local-state"/);
assert.match(html, /id="module-dashboard"/);
assert.match(html, /id="module-product-pool"/);
```

- [ ] **Step 2: Run server tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because the new shell elements are absent.

- [ ] **Step 3: Add semantic shell markup**

Add two navigation buttons before auto-listing using the same inline SVG convention. Add a fixed `.operations-topbar` inside `.app` and empty dashboard/product-pool sections with accessible headings. Keep all existing IDs unchanged.

```html
<header class="operations-topbar" id="operations-topbar">
  <div><span>本地服务</span><strong id="top-local-state">连接中</strong></div>
  <div><span>阿里授权</span><strong id="top-alibaba-state">尚未验证</strong></div>
  <div><span>当前批次</span><strong id="top-batch-state">未选择</strong></div>
  <div><span>最后保存</span><strong id="top-last-saved">—</strong></div>
</header>
```

- [ ] **Step 4: Replace ornamental styling with restrained business-console tokens**

Update CSS variables to use off-white paper, ink text, pale blue primary surfaces, orange warnings, and red errors. Remove the body dot texture and large surface shadows. Keep the rail hover behavior, reduce page heading size, and reserve shadows for drawers.

Use these tokens consistently:

```css
:root {
  --paper: #f5f6f8;
  --surface: #ffffff;
  --surface-blue: #f1f5ff;
  --ink: #172033;
  --muted: #6f7787;
  --line: #dfe3ea;
  --blue: #3158d4;
  --blue-soft: #e9efff;
  --orange: #c66a1b;
  --orange-soft: #fff3e8;
  --danger: #c7473f;
  --green: #278064;
}
```

- [ ] **Step 5: Wire top-bar state without exposing credentials**

Update local-service state from `/api/health`, Alibaba state from successful connection tests only, current batch from loaded/saved task state, and last saved from the successful `/api/tasks` response timestamp. Do not read or display secret fields.

- [ ] **Step 6: Verify shell tests and regression**

Run: `node --test tests/server.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

---

### Task 4: Product Pool Table, Filters, and Pagination

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `GET /api/tasks`, `buildProductRows`, `filterProductRows`, `sortProductRows`.
- Produces state: `taskSummaries`, `productRows`, `productPoolQuery`, `productPoolStage`, `productPoolSort`, `productPoolPage`.
- Produces DOM IDs: `pool-search`, `pool-stage`, `pool-table-body`, `pool-empty`, `pool-page`, `pool-prev`, `pool-next`, `pool-refresh`, `pool-export`.

- [ ] **Step 1: Write failing product-pool markup assertions**

```js
assert.match(html, /id="pool-search"/);
assert.match(html, /id="pool-stage"/);
assert.match(html, /id="pool-table-body"/);
assert.match(html, /id="pool-empty"/);
assert.match(html, /id="pool-refresh"/);
assert.match(html, /id="pool-export"/);
```

- [ ] **Step 2: Run server tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because product-pool controls are absent.

- [ ] **Step 3: Add the status banner, toolbar, filters, table, and empty state**

Use a compact default table with columns for checkbox, task ID, title, source product, variant, content, images, Schema, stage, updated time, and action. Add stage options `all`, `needs-content`, `needs-images`, `needs-preview`, and `preview-ready`.

- [ ] **Step 4: Implement fetch and rendering flow**

Import the pure model functions. `loadProductPool()` fetches `/api/tasks`, derives rows, refreshes the dashboard, and calls `renderProductPool()`. Render no more than 30 rows per page. Build DOM nodes with `textContent`; do not interpolate task data into `innerHTML`.

```js
async function loadProductPool() {
  const result = await requestJson('/api/tasks');
  state.taskSummaries = result.tasks;
  state.productRows = buildProductRows(result.tasks);
  renderDashboard();
  renderProductPool();
}
```

- [ ] **Step 5: Add real CSV export without external dependencies**

Export only currently filtered rows with literal headers `任务编号,商品标题,主产品ID,类似品序号,当前阶段,问题`. Escape double quotes by doubling them, create a UTF-8 BOM Blob, and trigger a local download named `商品池-YYYY-MM-DD.csv`.

- [ ] **Step 6: Verify markup, model, and full regression**

Run: `node --test tests/server.test.js tests/product-pool.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

---

### Task 5: Product Detail Drawer and Current Batch Panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `GET /api/tasks/:id` and selected `ProductRow`.
- Produces DOM IDs: `product-drawer`, `drawer-backdrop`, `drawer-close`, `drawer-tabs`, `drawer-content`, `current-batch-panel`.
- Produces: `openProductDrawer(row)` and `closeProductDrawer()`.

- [ ] **Step 1: Write failing drawer markup assertions**

```js
assert.match(html, /id="product-drawer"/);
assert.match(html, /aria-modal="true"/);
assert.match(html, /id="drawer-close"/);
assert.match(html, /id="current-batch-panel"/);
```

- [ ] **Step 2: Run server tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because drawer and current-batch panel are absent.

- [ ] **Step 3: Add accessible drawer markup and styles**

The drawer is fixed on the right, at most 720px wide, scrolls internally, and uses a backdrop. It starts hidden and uses `role="dialog"`, `aria-modal="true"`, and a labelled heading. The table remains visible behind it.

- [ ] **Step 4: Render six drawer tabs from safe task details**

Tabs are `概览`, `图片`, `文案`, `属性与 FAQ`, `Schema 预览`, and `日志`. Render text and image-bank URLs only. Never render raw Schema XML directly; show changed-field names and whether a local preview exists. Do not display local secret configuration.

- [ ] **Step 5: Implement keyboard and focus behavior**

Store the triggering button, focus the close button on open, close on Escape/backdrop/close button, return focus to the trigger, and set the hidden state consistently. Tab buttons use `aria-selected`.

- [ ] **Step 6: Populate the current batch panel**

When the current in-memory template contains four products, display four compact rows with title, image readiness, content readiness, and local preview status. The panel is read-only and links back to the existing auto-listing editor.

- [ ] **Step 7: Run regression tests**

Run: `npm test`

Expected: all tests PASS.

---

### Task 6: Dashboard, Auto-Listing Stage Bar, and Responsive QA

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `README.md`
- Verify: all source and test files

**Interfaces:**
- Consumes: `summarizeDashboard`, current in-memory products, photo-bank uploads, and local preview state.
- Produces dashboard IDs: `metric-batches`, `metric-products`, `metric-ready`, `metric-attention`, `recent-batches`.
- Produces stage IDs: `stage-materials`, `stage-keywords`, `stage-ai`, `stage-photobank`, `stage-preview`, `stage-save`.

- [ ] **Step 1: Add dashboard and stage markup assertions before implementation**

Extend the static HTML test to require all metric and stage IDs listed above, then run:

Run: `node --test tests/server.test.js`

Expected: FAIL because the IDs are absent.

- [ ] **Step 2: Implement the real-data dashboard**

Populate counts from `summarizeDashboard`. Render the five newest task summaries with task ID, product count, readiness, and updated time. Empty state links to auto-listing. No placeholder metrics are allowed.

- [ ] **Step 3: Replace the four-step strip with the six real stages**

Derive stage classes from actual state:

- materials: four main images and at least five auxiliary images
- keywords: at least one imported keyword
- ai: four similar products with non-empty titles and five FAQ pairs
- photobank: all assigned image keys contain `fileId` and `photobankUrl`
- preview: all four products have a preview whose changed fields include `images`
- save: a successful local task-save response exists for the current state

Use `pending`, `attention`, and `complete` classes with visible text, not color alone.

- [ ] **Step 4: Add responsive rules**

At widths below 1100px, let the table retain horizontal scrolling while the top status bar wraps to two rows. At widths below 760px, keep the rail closed, stack page toolbars, make the drawer full-width, and keep all action buttons at least 40px high.

- [ ] **Step 5: Update README**

Document the six navigation modules, local product pool, safe task detail behavior, CSV export, and the unchanged boundary that Alibaba draft and publish APIs are absent.

- [ ] **Step 6: Run final automated verification**

Run:

```powershell
npm test
node --check src/task-store.js
node --check src/server.js
node --check public/product-pool.js
node --check public/app.js
npm audit --omit=dev
rg -n "alibaba\.icbu\.product\.schema\.(add|update)|data:image" src public data/tasks -S
```

Expected: all tests PASS, syntax checks exit 0, audit reports zero vulnerabilities, and the safety scan finds no Alibaba product-write call or persisted Base64 payload. Existing test fixtures containing `data:image` are outside the scanned directories.

- [ ] **Step 7: Run browser smoke and responsive checks without external writes**

At `http://127.0.0.1:54025/`, verify:

- dashboard and product-pool navigation works;
- product-pool empty and populated states render;
- search, stage filtering, sort, pagination, and CSV export work;
- drawer opens, switches tabs, closes with Escape, and returns focus;
- left navigation expands on hover and remains usable at 1366×768 and 760×900;
- auto-listing, keywords, AI settings, and Alibaba settings still open;
- console has zero errors;
- no photo-bank upload, Alibaba draft, product update, or publish action is triggered.

- [ ] **Step 8: Report completion without Git actions**

Report exact modified files, test count, syntax/audit results, browser observations, and the deliberate next boundary: Alibaba draft saving requires a separate approved design and implementation plan.
