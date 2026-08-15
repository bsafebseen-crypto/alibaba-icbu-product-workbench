# AI Similar Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only workflow that assigns four main images and five auxiliary images per similar product, then uses an OpenAI-compatible model to generate four validated sets of title, selling points, first-five FAQ entries, and at most five custom-attribute changes.

**Architecture:** Add a pure domain module for image assignment and generated-content validation, extend the AI client with a four-product multimodal request, and extend the Schema module with conservative custom-attribute and first-five FAQ updates. Keep browser-only image compression and editing state in a focused public module consumed by the existing workbench UI. The server remains a local orchestrator and must not call Alibaba photo-bank, draft, or publish APIs.

**Tech Stack:** Node.js 20+, Node built-in test runner, browser ES modules, OpenAI-compatible Chat Completions API, fast-xml-parser 5.10.1, existing HTML/CSS workbench.

## Global Constraints

- Four main images map one-to-one to similar products 1 through 4.
- Each similar product receives exactly five auxiliary images; fewer than five pool images is an error.
- Each generated result contains exactly five non-empty FAQ pairs.
- Each result applies at most five custom-attribute changes using only `add`, `update`, or `delete`.
- Existing standard attributes, price, SKU, details, logistics, grouping, and Schema image fields remain unchanged.
- API keys, Alibaba secrets, access tokens, image data URLs, and complete Schema XML must not be persisted or sent to the AI model.
- This feature must not call `alibaba.icbu.photobank.upload`, `alibaba.icbu.product.schema.add.draft`, or `alibaba.icbu.product.schema.add`.
- The server continues to bind only to `127.0.0.1`.
- The workspace is not a Git repository by user choice; commit steps are intentionally omitted until repository creation is requested.

---

### Task 1: Similar-product domain rules

**Files:**
- Create: `src/similar-product-content.js`
- Create: `tests/similar-product-content.test.js`

**Interfaces:**
- Produces: `assignProductImages(mainImages, auxiliaryImages)` returning four `{ mainImageIndex, auxiliaryImageIndexes }` assignments.
- Produces: `applyAttributeChanges(sourceAttributes, changes)` returning `{ attributes, changes }` without mutating inputs.
- Produces: `validateSimilarProductGeneration(value, context)` returning four normalized product objects.
- Consumes: `context.allowedKeywords` and `context.sourceAttributes`.

- [ ] **Step 1: Write failing image-assignment tests**

```js
test('assignProductImages maps four main images and rotates five auxiliary images', () => {
  assert.deepEqual(assignProductImages(['m1','m2','m3','m4'], ['a1','a2','a3','a4','a5','a6'])[1], {
    mainImageIndex: 1,
    auxiliaryImageIndexes: [1, 2, 3, 4, 5],
  });
});

test('assignProductImages rejects missing main or auxiliary images', () => {
  assert.throws(() => assignProductImages(['m1'], ['a1','a2','a3','a4','a5']), /需要 4 张主图/);
  assert.throws(() => assignProductImages(['m1','m2','m3','m4'], ['a1']), /至少需要 5 张副图/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/similar-product-content.test.js`

Expected: FAIL because `src/similar-product-content.js` does not exist.

- [ ] **Step 3: Implement deterministic image assignment**

```js
export function assignProductImages(mainImages, auxiliaryImages) {
  if (mainImages.length !== 4) throw new Error('需要 4 张主图');
  if (auxiliaryImages.length < 5) throw new Error('至少需要 5 张副图');
  return mainImages.map((_, index) => ({
    mainImageIndex: index,
    auxiliaryImageIndexes: Array.from({ length: 5 }, (_unused, offset) =>
      (index + offset) % auxiliaryImages.length),
  }));
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/similar-product-content.test.js`

Expected: PASS for both image-assignment tests.

- [ ] **Step 5: Write failing attribute-difference tests**

Cover `add`, `update`, and `delete`; input immutability; update/delete names that do not exist; duplicate final names; and more than five changes.

```js
test('applyAttributeChanges changes at most five rows and preserves untouched order', () => {
  const source = [{ name: 'Material', value: 'Polyester' }, { name: 'Closure', value: 'Zipper' }];
  const result = applyAttributeChanges(source, [
    { operation: 'update', name: 'Closure', after: 'Smooth Zipper' },
    { operation: 'add', name: 'Use', after: 'Traffic Control' },
  ]);
  assert.deepEqual(result.attributes, [
    { name: 'Material', value: 'Polyester' },
    { name: 'Closure', value: 'Smooth Zipper' },
    { name: 'Use', value: 'Traffic Control' },
  ]);
  assert.equal(source[1].value, 'Zipper');
});
```

- [ ] **Step 6: Verify attribute tests fail for missing behavior**

Run: `node --test tests/similar-product-content.test.js`

Expected: FAIL because `applyAttributeChanges` is not exported.

- [ ] **Step 7: Implement minimal attribute-difference application**

Normalize names case-insensitively, reject empty names or values, enforce five changes, and return normalized change summaries containing `before` and `after`.

- [ ] **Step 8: Write failing four-product validation tests**

Test exactly four results, 128-character title limit, exactly five FAQ pairs, keywords constrained to the uploaded list, and application of attribute changes against source attributes.

```js
assert.throws(
  () => validateSimilarProductGeneration({ products: [] }, context),
  /必须正好生成 4 个类似品/,
);
```

- [ ] **Step 9: Implement and verify generated-content validation**

Run: `node --test tests/similar-product-content.test.js`

Expected: all Task 1 tests PASS.

---

### Task 2: Conservative Schema support for custom attributes and first-five FAQ

**Files:**
- Modify: `tests/fixtures/product-schema.xml`
- Modify: `tests/schema-template.test.js`
- Modify: `src/schema-template.js`

**Interfaces:**
- Extends: `analyzeProductSchema(schemaXml).recognized.customAttributes` with `{ fieldId, items }` or `null`.
- Extends: `createProductPreview(schemaXml, variant)` to consume `variant.faqItems` and `variant.customAttributes` while preserving compatibility with the existing `variant.faq` string.

- [ ] **Step 1: Extend the sanitized fixture and write failing recognition tests**

Represent a custom-attribute container using a stable fixture field ID `custom_attributes` with repeated name/value child pairs. Include at least six FAQ pairs so preservation of entries after the fifth is observable.

```js
assert.deepEqual(analysis.recognized.customAttributes.items[0], {
  name: 'Material', value: 'Polyester',
});
```

- [ ] **Step 2: Run Schema tests and verify RED**

Run: `node --test tests/schema-template.test.js`

Expected: FAIL because `customAttributes` recognition is missing.

- [ ] **Step 3: Add conservative custom-attribute recognition**

Recognize only explicit aliases `customattributes`, `customattribute`, and `customprops`. Return `null` plus warning `未识别自定义属性字段` when absent. Do not match standard attribute containers.

- [ ] **Step 4: Write failing preview-mutation tests**

Assert that the first five FAQ entries change, the sixth remains byte-equivalent in value, custom attributes reflect validated rows, and price/SKU/unknown fields remain unchanged.

- [ ] **Step 5: Implement minimal Schema mutation and verify GREEN**

Update only the recognized custom-attribute node and first five FAQ slots. Reject previews when custom attributes cannot be identified. Run:

`node --test tests/schema-template.test.js`

Expected: all Schema tests PASS.

---

### Task 3: Four-product multimodal AI request

**Files:**
- Modify: `tests/ai-client.test.js`
- Modify: `src/ai-client.js`

**Interfaces:**
- Produces: `generateSimilarProducts(config, source, fetchImpl = fetch)`.
- Consumes: `source.imageDataUrls`, `source.imageAssignments`, `source.words`, `source.manualFacts`, and `source.originalContent`.
- Uses: `validateSimilarProductGeneration` from Task 1.

- [ ] **Step 1: Write a failing multimodal request test**

Assert the user message is an array containing text and `image_url` items, the prompt requests exactly four products, and the serialized request excludes `schemaXml`, `appSecret`, `accessToken`, and unrelated source object properties.

```js
const userContent = requestBody.messages[1].content;
assert.equal(userContent.filter((item) => item.type === 'image_url').length, 9);
assert.doesNotMatch(JSON.stringify(requestBody), /access-token|<itemSchema>/);
```

- [ ] **Step 2: Run AI tests and verify RED**

Run: `node --test tests/ai-client.test.js`

Expected: FAIL because `generateSimilarProducts` is not exported.

- [ ] **Step 3: Implement the strict multimodal request**

Build a safe text payload from an explicit allow-list. Add each unique compressed data URL once with a stable image label in the text. Request JSON with exactly four results, five FAQ pairs, at most five attribute changes, and no unsupported product facts.

- [ ] **Step 4: Add provider-rejection and text-only tests**

Expose an explicit `source.useImages` switch. With `false`, send only text and return products marked `visionUsed: false`. With `true`, propagate a readable provider error instead of silently retrying.

- [ ] **Step 5: Run AI tests and verify GREEN**

Run: `node --test tests/ai-client.test.js`

Expected: all AI tests PASS without logging secrets or image data.

---

### Task 4: Local HTTP endpoint and request-size boundary

**Files:**
- Modify: `tests/server.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Adds: `POST /api/products/generate-similar`.
- Request: `{ config, source }` where `source` is the safe structure from Task 3.
- Response: `{ products, visionUsed }` with no `apiKey` or image data URLs.

- [ ] **Step 1: Write failing endpoint tests**

Inject `generateSimilarProductsImpl`, assert it receives the request, assert the response omits credentials and image data, and assert provider errors become a safe 400 response.

- [ ] **Step 2: Run server tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL with HTTP 404 for `/api/products/generate-similar`.

- [ ] **Step 3: Implement the endpoint and bounded JSON reader**

Raise the JSON body limit only for this endpoint to 24 MiB, sufficient for nine compressed images, while retaining the existing lower limit for other endpoints. Reject oversized requests with HTTP 413 and a Chinese message. Never echo the request body in errors.

- [ ] **Step 4: Verify endpoint tests GREEN**

Run: `node --test tests/server.test.js`

Expected: all server tests PASS.

---

### Task 5: Workbench image, attribute, FAQ, and generation UI

**Files:**
- Create: `public/similar-product-ui.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/server.test.js`
- Create: `tests/similar-product-ui.test.js`

**Interfaces:**
- Produces browser helpers: `compressImage(file, options)`, `renderAttributeRows(container, rows, changes)`, `readAttributeRows(container)`, `renderFaqRows(container, items)`, and `readFaqRows(container)`.
- `app.js` owns files and object URLs; `similar-product-ui.js` owns rendering and input normalization.

- [ ] **Step 1: Write failing static markup tests**

Assert IDs `similar-main-images`, `auxiliary-image-pool`, `assigned-images`, `custom-attribute-rows`, `faq-rows`, and `ai-generate-similar` exist. Assert the old “六张主图” copy is gone from the template workflow.

- [ ] **Step 2: Run static tests and verify RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because the new controls are absent.

- [ ] **Step 3: Add minimal semantic markup and styles**

Create four numbered main-image slots, one multi-file auxiliary input, six assigned-image cards for the active similar product, a structured attribute table, and five FAQ row groups. Match the existing restrained editorial visual language; no decorative gradients or unrelated animation.

- [ ] **Step 4: Write failing pure UI-helper tests**

Using small fake containers or serialized row input, verify attribute and FAQ normalization, duplicate-name errors, and five-pair enforcement. Keep Canvas/image decoding out of Node tests.

- [ ] **Step 5: Implement focused UI helpers and verify GREEN**

Run: `node --test tests/similar-product-ui.test.js`

Expected: all helper tests PASS.

- [ ] **Step 6: Integrate image state and client-side compression**

Store four main `File` objects, auxiliary pool files, per-product assignments, and compressed data URLs in memory. `compressImage` uses `createImageBitmap`, a canvas capped at 1536 px longest edge, and `canvas.toBlob('image/jpeg', 0.82)`. Revoke object URLs when replacing files.

- [ ] **Step 7: Integrate template-mode AI generation**

Before the request, validate four main images, five auxiliary images, keywords, model configuration, and a loaded source template. Send only recognized original content and compressed images. Apply the response atomically to all four product states and display `已识图` or `文字模式`.

- [ ] **Step 8: Preserve manual edits on regeneration**

Track a per-product `manuallyEdited` flag. If any flag is set, require a native confirmation before replacing content; cancellation must leave state unchanged.

- [ ] **Step 9: Run static and full UI-adjacent tests**

Run: `node --test tests/server.test.js tests/similar-product-ui.test.js`

Expected: all selected tests PASS.

---

### Task 6: Preview integration, documentation, and full verification

**Files:**
- Modify: `tests/server.test.js`
- Modify: `tests/schema-template.test.js`
- Modify: `public/app.js`
- Modify: `README.md`

**Interfaces:**
- Existing: `POST /api/products/preview` accepts the normalized products from Task 1.
- Existing: local task saving stores file names and image assignments, not data URLs.

- [ ] **Step 1: Write failing preview and storage tests**

Assert preview accepts `faqItems` and `customAttributes`, changed fields include `customAttributes`, and saved tasks contain image names/assignments but no `data:image/`, `apiKey`, Alibaba secret, or access token.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/server.test.js tests/schema-template.test.js tests/task-store.test.js`

Expected: FAIL because the extended preview/storage behavior is missing.

- [ ] **Step 3: Integrate normalized content with preview and task saving**

Convert five FAQ row objects to the Schema module input, pass custom attributes, include safe image metadata in the saved task, and strip all transient data URLs before sending the task request.

- [ ] **Step 4: Update README boundaries and operating steps**

Document four main images, auxiliary pool, model image support, explicit text fallback, five FAQ pairs, five attribute changes, and the fact that images are not uploaded to Alibaba in this phase.

- [ ] **Step 5: Run complete automated verification**

Run:

```powershell
npm test
node --check public/app.js
node --check public/similar-product-ui.js
npm audit --omit=dev
rg -n "alibaba\.icbu\.photobank\.upload|alibaba\.icbu\.product\.schema\.add(\.draft)?" src public
```

Expected: all tests pass; both syntax checks exit 0; audit reports 0 vulnerabilities; the final search returns no production write-call implementation.

- [ ] **Step 6: Browser smoke test**

Open `http://127.0.0.1:54025/`, verify the responsive layout, upload four main images and at least five auxiliary images, switch all four product tabs, edit one attribute and one FAQ pair, and trigger a validation error without calling a real model. Confirm the console has no errors.

- [ ] **Step 7: Re-read acceptance criteria and report remaining live-data gap**

Confirm each criterion in `docs/superpowers/specs/2026-08-09-ai-similar-products-design.md`. Report that real provider generation and real Alibaba Schema alias calibration remain unverified until the user supplies a compatible model and loads one real source product; do not present those external integrations as completed.
