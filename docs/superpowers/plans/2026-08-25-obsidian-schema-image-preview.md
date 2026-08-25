# Obsidian Schema and Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the manually published source product, prepare four complete variants with newly selected local images, and show exact schema diffs without writing drafts or products.

**Architecture:** Read-only Alibaba metadata/schema loading produces an explicit publish context. A domain layer maps the four unselected plans into strict variant input. Existing schema patching is hardened to prove that only approved roles changed, while image upload remains an explicit user-confirmed operation.

**Tech Stack:** Node.js 20+, native `fetch`, `fast-xml-parser`, browser JavaScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-obsidian-similar-product-publishing-design.md`

## Global Constraints

- Do not call `alibaba.icbu.product.schema.add.draft` or `alibaba.icbu.product.schema.add`.
- `alibaba.photobank.redefining.upload` remains allowed only after the existing explicit confirmation.
- Do not guess `cat_id`, `language`, `publish_type`, or `version`; obtain them from read-only responses or require an explicit resolved value and block if incomplete.
- Change only title, selling points, first five FAQs, the six product images, and all custom attributes (exactly ten).
- Preserve standard attributes, SKU, price, certificates, logistics, details, and unrecognized XML nodes byte-semantically through parse/build comparison.
- Do not persist source or preview XML.

## File and Responsibility Map

- `src/alibaba-client.js`: read-only source context/schema retrieval.
- `src/obsidian-variant.js`: map batch plans and validate exact mutable data.
- `src/schema-template.js`: role patching and invariant report.
- `src/server.js`: read-only source/preview routes and existing confirmed image upload reuse.
- `public/obsidian-publishing.js`: four variant cards, image assignment, preview status.
- `tests/fixtures/`: sanitized Alibaba response/schema fixtures.
- `tests/alibaba-client.test.js`, `tests/obsidian-variant.test.js`, `tests/schema-template.test.js`, `tests/server.test.js`: coverage.

## Interfaces

```js
export async function loadAlibabaProductContext(config, { productId }, fetchImpl, timestamp) {}
// => { productId, categoryId, language, publishType, version, schemaXml }

export function createObsidianVariants(batch, basePlanId) {}
// => [{ planId, title, sellingPoints, faqs, customAttributes } x 4]

export function createStrictProductPreview(schemaXml, variant) {}
// => { previewXml, changedFields, preservedFields, warnings, fingerprint }
```

### Task 1: Capture and normalize the read-only publish context

- [ ] Add failing client tests using sanitized fixtures for the source-product metadata and schema-render responses.
- [ ] Assert that normalization returns all five required values: product ID, category ID, language, publish type, and schema version; an absent value must produce `INCOMPLETE_PUBLISH_CONTEXT`.
- [ ] Run `node --test tests/alibaba-client.test.js` and confirm failure before implementation.
- [ ] Implement `loadAlibabaProductContext` using only official read methods. Keep request construction in one function and include optional fields only when the preceding official response supplies them.
- [ ] Preserve the current `loadAlibabaProductTemplate` export as a compatibility wrapper for the old module.
- [ ] Run the test and commit:

```powershell
git add src/alibaba-client.js tests/alibaba-client.test.js tests/fixtures
git commit -m "feat: resolve source product publish context"
```

### Task 2: Build four strict variants

- [ ] Add failing tests for selecting each possible base plan and returning the other four in source order.
- [ ] Validate title length (1–128), non-empty selling points, exactly five complete FAQs, exactly ten unique custom-attribute names, and no image data at this layer.
- [ ] Implement `createObsidianVariants` without mutating the imported batch.
- [ ] Run `node --test tests/obsidian-variant.test.js`.
- [ ] Commit:

```powershell
git add src/obsidian-variant.js tests/obsidian-variant.test.js
git commit -m "feat: map Obsidian plans into four variants"
```

### Task 3: Harden schema patch invariants

- [ ] Add a fixture containing recognized mutable roles plus standard attributes, SKU, price, certificates, logistics, details, and an unknown extension node.
- [ ] Add failing tests asserting exactly these mutations:

```js
assert.deepEqual(result.changedFields.sort(), [
  'customAttributes', 'faq', 'images', 'productSummary', 'title'
]);
assert.equal(result.preservedFields.sku, true);
assert.equal(result.preservedFields.price, true);
assert.equal(result.preservedFields.logistics, true);
```

- [ ] Refactor the existing preview function only as needed to expose preservation evidence and a SHA-256 fingerprint.
- [ ] Require six `{fileId,url}` images and exactly ten custom attributes for the new strict wrapper; retain old-module behavior in `createProductPreview`.
- [ ] Compare canonicalized pre/post subtrees for all non-mutable roles and fail closed on an unrecognized schema layout.
- [ ] Run `node --test tests/schema-template.test.js tests/obsidian-variant.test.js`.
- [ ] Commit:

```powershell
git add src/schema-template.js src/obsidian-variant.js tests/schema-template.test.js tests/fixtures
git commit -m "feat: prove strict similar-product schema changes"
```

### Task 4: Add source and preview server routes

- [ ] Add `POST /api/obsidian/source-product` with `{config,productId}` and return publish context plus schema analysis; do not return credentials.
- [ ] Add `POST /api/obsidian/preview` with `{sourceContext,batch,basePlanId,imagesByPlan}` and return four preview summaries and transient preview XML to the active browser response only.
- [ ] Reuse `/api/alibaba/photobank/upload`; do not add an unconfirmed batch-upload route.
- [ ] Inject all new dependencies through `createServer(options)` for tests.
- [ ] Add route tests for incomplete context, invalid batch, five or seven images, schema mismatch, and successful four-preview output.
- [ ] Assert mocked draft/formal-publish functions are never called.
- [ ] Run `node --test tests/server.test.js`.
- [ ] Commit:

```powershell
git add src/server.js tests/server.test.js
git commit -m "feat: preview Obsidian variants without product writes"
```

### Task 5: Add image assignment and exact-change preview UI

- [ ] Extend each of the four variant cards with one main-image and five auxiliary-image slots.
- [ ] Reuse compression/data-URL helpers from `public/similar-product-ui.js`, but keep per-plan assignment state isolated.
- [ ] Require one explicit confirmation listing the number of images before uploading to the photo bank.
- [ ] After uploads, request strict previews and render title, selling points, five FAQs, ten custom attributes, six image thumbnails, preserved-field checks, warnings, and fingerprint.
- [ ] Disable the next phase unless all four previews are valid and fingerprints are current.
- [ ] Add pure UI tests for assignment counts, stale-preview invalidation after any edit, and four-card status mapping.
- [ ] Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`.
- [ ] Commit:

```powershell
git add public/obsidian-publishing.js public/styles.css tests/obsidian-publishing-ui.test.js
git commit -m "feat: preview four image-backed similar products"
```

### Task 6: Verify Phase 2 safety

- [ ] Update `README.md` with source-product permission requirements, image-bank confirmation, and the preserved-field list.
- [ ] Run `rg -n "schema\.add(\.draft)?" src public` and verify the new module contains no product-write call.
- [ ] Run `npm test` and `git diff --check`.
- [ ] Manually load the user's source product ID through the read-only route and verify four previews; do not click any product-write action.
- [ ] Commit documentation:

```powershell
git add README.md
git commit -m "docs: explain strict schema preview workflow"
```

## Phase 2 Acceptance

- The source product loads with a complete, evidence-backed publish context.
- Six local images per variant are uploaded only after confirmation.
- Four previews show exactly the allowed changes and prove protected fields are preserved.
- No draft or formal product is created.

