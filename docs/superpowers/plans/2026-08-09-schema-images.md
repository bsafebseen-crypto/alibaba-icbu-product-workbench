# Alibaba Schema Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate four local Alibaba Schema previews whose `scImages_0..5` rows exactly match each similar product's uploaded main and auxiliary image assignment.

**Architecture:** Extend the existing Schema analyzer/writer with one optional `alibabaImages` input, add a pure browser helper that resolves assignments against photo-bank upload metadata, and expose a separate local-only UI action that reuses `POST /api/products/preview`. Existing content-only previews remain compatible.

**Tech Stack:** Node.js 20+, browser ES modules, `fast-xml-parser`, Node built-in test runner.

## Global Constraints

- Write exactly one main image followed by five auxiliary images as `scImages_0..5`.
- Require both `fileId` and `photobankUrl`; never place base64 data in Schema or task files.
- Do not call Alibaba draft, product update, or publish APIs.
- Preserve every unedited Schema field and FAQ row 6 onward.
- Do not initialize or commit a Git repository; the user deferred repository creation.

---

### Task 1: Resolve Uploaded Images for Each Similar Product

**Files:**
- Modify: `public/similar-product-ui.js`
- Test: `tests/similar-product-ui.test.js`

**Interfaces:**
- Consumes: `imageAssignment: { mainImageIndex: number, auxiliaryImageIndexes: number[] }` and `photobankUploads: Record<string, { fileId: string, photobankUrl: string }>`.
- Produces: `resolveAlibabaImages(product, photobankUploads, productIndex): Array<{ fileId: string, url: string }>`.

- [ ] **Step 1: Write the failing mapping tests**

Add tests that call the wished-for helper with `main:2` and five ordered auxiliary keys:

```js
import { resolveAlibabaImages } from '../public/similar-product-ui.js';

test('resolveAlibabaImages returns one main image followed by five assigned auxiliary images', () => {
  const product = {
    imageAssignment: { mainImageIndex: 2, auxiliaryImageIndexes: [4, 1, 3, 0, 2] },
  };
  const uploads = {
    'main:2': { fileId: 'm2', photobankUrl: 'https://img/m2.jpg' },
    'auxiliary:0': { fileId: 'a0', photobankUrl: 'https://img/a0.jpg' },
    'auxiliary:1': { fileId: 'a1', photobankUrl: 'https://img/a1.jpg' },
    'auxiliary:2': { fileId: 'a2', photobankUrl: 'https://img/a2.jpg' },
    'auxiliary:3': { fileId: 'a3', photobankUrl: 'https://img/a3.jpg' },
    'auxiliary:4': { fileId: 'a4', photobankUrl: 'https://img/a4.jpg' },
  };

  assert.deepEqual(resolveAlibabaImages(product, uploads, 0), [
    { fileId: 'm2', url: 'https://img/m2.jpg' },
    { fileId: 'a4', url: 'https://img/a4.jpg' },
    { fileId: 'a1', url: 'https://img/a1.jpg' },
    { fileId: 'a3', url: 'https://img/a3.jpg' },
    { fileId: 'a0', url: 'https://img/a0.jpg' },
    { fileId: 'a2', url: 'https://img/a2.jpg' },
  ]);
});

test('resolveAlibabaImages names the missing slot and product', () => {
  assert.throws(
    () => resolveAlibabaImages({
      imageAssignment: { mainImageIndex: 0, auxiliaryImageIndexes: [0, 1, 2, 3, 4] },
    }, { 'main:0': { fileId: 'm0', photobankUrl: 'https://img/m0.jpg' } }, 1),
    /类似品 2.*副图 1.*尚未上传/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/similar-product-ui.test.js`

Expected: FAIL because `resolveAlibabaImages` is not exported.

- [ ] **Step 3: Implement the minimal pure mapping helper**

Add a function that validates five unique auxiliary indexes, resolves keys in main-then-auxiliary order, trims metadata, and throws a Chinese slot-specific error:

```js
export function resolveAlibabaImages(product, photobankUploads, productIndex = 0) {
  const assignment = product?.imageAssignment;
  const auxiliary = assignment?.auxiliaryImageIndexes;
  if (!Number.isInteger(assignment?.mainImageIndex)
    || !Array.isArray(auxiliary)
    || auxiliary.length !== 5
    || new Set(auxiliary).size !== 5) {
    throw new Error(`类似品 ${productIndex + 1} 的图片分配不完整`);
  }
  const slots = [
    { key: `main:${assignment.mainImageIndex}`, label: '主图' },
    ...auxiliary.map((index, offset) => ({ key: `auxiliary:${index}`, label: `副图 ${offset + 1}` })),
  ];
  return slots.map(({ key, label }) => {
    const upload = photobankUploads?.[key];
    const fileId = String(upload?.fileId || '').trim();
    const url = String(upload?.photobankUrl || '').trim();
    if (!fileId || !url) throw new Error(`类似品 ${productIndex + 1} 的${label}尚未上传完整`);
    return { fileId, url };
  });
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/similar-product-ui.test.js`

Expected: PASS with no warnings.

---

### Task 2: Recognize and Replace `scImages` in Alibaba Schema

**Files:**
- Modify: `src/schema-template.js`
- Modify: `tests/schema-template.test.js`

**Interfaces:**
- Consumes: existing `schemaXml` and optional `variant.alibabaImages: Array<{ fileId: string, url: string }>`.
- Produces: `analysis.recognized.images: { fieldId: string, items: Array<{ fileId: string, url: string }> } | null`; preview `changedFields` includes `images` only when images were supplied.

- [ ] **Step 1: Add a realistic image field to the rendered Schema fixture and write failing tests**

Extend `renderedAlibabaSchemaXml` with:

```xml
<field id="scImages" type="complex">
  <complex-value><field id="scImages_0"><value fileId="old-0">https://img/old-0.jpg</value></field></complex-value>
  <complex-value><field id="scImages_1"><value fileId="old-1">https://img/old-1.jpg</value></field></complex-value>
</field>
```

Then assert analysis and replacement:

```js
test('createProductPreview replaces scImages with six Alibaba photo-bank images', () => {
  const alibabaImages = Array.from({ length: 6 }, (_, index) => ({
    fileId: `new-${index}`,
    url: `https://img/new-${index}.jpg`,
  }));
  const preview = createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New title',
    sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, (_, index) => ({ question: `Q${index}?`, answer: `A${index}.` })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    alibabaImages,
  });

  assert.deepEqual(analyzeProductSchema(preview.previewXml).recognized.images.items, alibabaImages);
  assert.deepEqual(preview.changedFields, ['title', 'productSummary', 'faq', 'customAttributes', 'images']);
  assert.match(preview.previewXml, /KEEP-SKU/);
  assert.doesNotMatch(preview.previewXml, /old-0/);
});

test('createProductPreview rejects incomplete Alibaba image metadata', () => {
  assert.throws(() => createProductPreview(renderedAlibabaSchemaXml, {
    title: 'New title', sellingPoints: 'New summary',
    faqItems: Array.from({ length: 5 }, () => ({ question: 'Question?', answer: 'Answer.' })),
    customAttributes: [{ name: 'Material', value: 'Polyester' }],
    alibabaImages: Array.from({ length: 6 }, () => ({ fileId: '', url: 'https://img/x.jpg' })),
  }), /fileId 和 URL/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/schema-template.test.js`

Expected: FAIL because `images` is not recognized and `scImages` is not changed.

- [ ] **Step 3: Implement image recognition and writing**

Add `images: /^(scimages)$/` to `ROLE_PATTERNS`. Add image readers that inspect the direct `scImages_N` rows, take URL from the row's value carrier, and take `fileId` from the carrier's `@_fileId` attribute. Add a writer that clones the first direct image row six times, sets `@_id` to `scImages_0..5`, sets the value text and `@_fileId`, and replaces only the image rows in the parent container.

The optional branch in `createProductPreview` must be:

```js
if (variant.alibabaImages !== undefined) {
  writeAlibabaImages(roleFields.images, variant.alibabaImages);
  changedFields.push('images');
}
```

Keep missing `images` out of the general `analysis.warnings`, so old content-only preview remains backward compatible; `writeAlibabaImages` itself throws `Schema 缺少可安全替换的图片结构` when an image preview is requested without the role.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/schema-template.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

---

### Task 3: Add the Explicit Full-Preview Workbench Action

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `resolveAlibabaImages(product, state.photobankUploads, index)` and existing `POST /api/products/preview`.
- Produces: a button with id `generate-image-previews` and four previews containing `changedFields: [..., 'images']`.

- [ ] **Step 1: Write failing page and HTTP integration tests**

Extend the static page assertion:

```js
assert.match(html, /id="generate-image-previews"/);
assert.match(html, /生成含图片的完整预览/);
```

Extend the preview route test products with six image objects and assert the injected preview factory receives them and returns `images` in each `changedFields`. Use dependency injection already supported by `createServer` rather than making Alibaba calls.

- [ ] **Step 2: Run server tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because the new button is absent.

- [ ] **Step 3: Add the button and local-only generation flow**

Place the button next to the existing content preview action:

```html
<button class="button primary hidden" id="generate-image-previews" type="button" disabled>
  生成含图片的完整预览
</button>
```

Register the id in `app.js`. In `updatePhotobankControls`, enable it only when template mode is active, the Schema reports `recognized.images`, and every required upload has metadata. Add `generateImageProductPreviews()` that first calls `syncCurrentProduct()`, resolves all four image arrays before changing state, sends cloned products with `alibabaImages`, then installs all four returned previews together.

Use these exact success and failure semantics:

```js
const products = state.products.map((product, index) => ({
  ...product,
  alibabaImages: resolveAlibabaImages(product, state.photobankUploads, index),
}));
// POST /api/products/preview with source Schema and products
setStatus(elements['action-message'], '4 份含图片的完整本地预览已生成；未创建草稿、未发布商品。', 'success');
```

When a main image, auxiliary pool, or assignment changes, delete each product's existing `preview` so stale XML cannot be saved as current.

- [ ] **Step 4: Run server tests and full regression**

Run: `node --test tests/server.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS with no warnings.

---

### Task 4: Documentation and Browser Safety Verification

**Files:**
- Modify: `README.md`
- Verify: `public/index.html`, `public/app.js`, `src/server.js`

**Interfaces:**
- Consumes: completed local full-preview flow.
- Produces: user-facing instructions and evidence that no Alibaba product-write API is invoked.

- [ ] **Step 1: Update the README workflow**

Document this exact order: read source product, prepare four main images and auxiliary pool, upload assigned files to photo bank with confirmation, generate full local preview, inspect changed fields, and stop before any draft/publish operation. State explicitly that this phase does not create products.

- [ ] **Step 2: Run static safety scans**

Run:

```powershell
rg -n "schema\.add|product\.update|publish" src public -S
rg -n "data:image" data/tasks -S
```

Expected: no new product-write API call; no base64 images in saved task JSON. Existing explanatory copy containing “publish” is allowed after manual inspection.

- [ ] **Step 3: Run final automated verification**

Run:

```powershell
npm test
node --check src/schema-template.js
node --check public/similar-product-ui.js
node --check public/app.js
node --check src/server.js
npm audit --omit=dev
```

Expected: all tests PASS, all syntax checks exit 0, audit reports 0 vulnerabilities.

- [ ] **Step 4: Perform a local browser smoke test without live writes**

Open `http://127.0.0.1:54025/`, verify the full-preview button is visible only in template mode, disabled before all photo-bank metadata exists, and the page has no console errors. Do not click the photo-bank upload button and do not invoke any Alibaba product-write endpoint during this smoke test.

- [ ] **Step 5: Report completion without Git actions**

List the exact modified files, automated verification results, browser observations, and the remaining deliberate boundary: draft creation and formal publishing are not implemented in this phase.
