# Obsidian Listing Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only workbench module that discovers validated five-plan listing batches under the fixed Obsidian directory and lets the user select the already-published base plan.

**Architecture:** A small server-side parser owns path containment and the versioned Markdown contract. Two read-only HTTP endpoints expose sanitized batch metadata/content. A dedicated browser controller renders the new module without coupling it to the existing automatic-listing state.

**Tech Stack:** Node.js 20+, native `http`, ES modules, browser JavaScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-obsidian-similar-product-publishing-design.md`

## Global Constraints

- This phase performs no Alibaba product write and no image upload.
- The only readable root is `C:\obsidian\obsidian\国际站发品`; reject traversal and symlink escape.
- Accept only `.md` files with exactly one versioned machine block, exactly five plans, five FAQs per plan, and ten custom attributes per plan.
- Never persist the Markdown body, product ID, credentials, schema XML, or images in Git.
- Existing automatic-listing behavior and its five-attribute rule remain unchanged.

## File and Responsibility Map

- `src/obsidian-listing.js`: path-safe discovery, machine-block extraction, contract validation.
- `src/server.js`: read-only Obsidian endpoints and static asset allowlist.
- `public/obsidian-publishing.js`: isolated module state and rendering.
- `public/index.html`, `public/styles.css`, `public/app.js`: navigation shell and initialization only.
- `tests/obsidian-listing.test.js`, `tests/obsidian-publishing-ui.test.js`, `tests/server.test.js`: unit and route coverage.
- `AGENTS.md`, `README.md`: scoped safety rule and operator instructions.

## Interfaces

```js
export const OBSIDIAN_LISTING_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_ROOT = 'C:\\obsidian\\obsidian\\国际站发品';
export function extractListingPayload(markdown) {}
export function validateListingBatch(payload, source) {}
export async function listObsidianBatches(rootDir) {}
export async function readObsidianBatch(rootDir, relativePath) {}
```

The machine block is delimited exactly as follows:

````markdown
<!-- alibaba-listing-batch:start -->
```json
{"schemaVersion":1,"batchId":"reflective-vest-001","batchName":"Reflective Vest","plans":[]}
```
<!-- alibaba-listing-batch:end -->
````

Each plan has `id`, `title`, `sellingPoints`, `faqs`, and `customAttributes`; `faqs` contains five `{question, answer}` values and `customAttributes` contains ten `{name, value}` values.

### Task 1: Establish the scoped repository policy

- [ ] Add an `Obsidian similar-product module` paragraph to `AGENTS.md` stating that Plans 1–2 are read-only, the new contract requires ten custom attributes, and product writes remain prohibited.
- [ ] Add a test in `tests/obsidian-listing.test.js` that initially fails because `src/obsidian-listing.js` does not exist.
- [ ] Run `node --test tests/obsidian-listing.test.js` and confirm the module-not-found failure.
- [ ] Commit only the policy and failing test:

```powershell
git add AGENTS.md tests/obsidian-listing.test.js
git commit -m "test: define Obsidian listing import contract"
```

### Task 2: Parse and validate one listing batch

- [ ] Implement marker extraction with exactly one start marker, one JSON fence, and one end marker. Reject missing, duplicated, malformed, or oversized (over 2 MiB) blocks.
- [ ] Implement validation with actionable paths such as `plans[2].faqs must contain exactly 5 entries`.
- [ ] Normalize strings with `trim()` but do not rewrite listing content.
- [ ] Add tests for valid input, invalid JSON, wrong version, duplicate plan IDs, plan count, FAQ count, attribute count, and blank strings.
- [ ] Run `node --test tests/obsidian-listing.test.js` and confirm all parser tests pass.
- [ ] Commit:

```powershell
git add src/obsidian-listing.js tests/obsidian-listing.test.js
git commit -m "feat: validate Obsidian listing batches"
```

### Task 3: Discover files without escaping the vault root

- [ ] Add recursive `.md` discovery returning only `{relativePath,fileName,modifiedAt,size,valid,error,batchId,batchName}`.
- [ ] Resolve the root and candidate with `path.resolve`; require the candidate to start with `${resolvedRoot}${path.sep}` and reject symlinks whose `realpath` escapes the root.
- [ ] Make `readObsidianBatch` accept a relative path only and return the validated payload plus safe source metadata.
- [ ] Test nested folders, non-Markdown files, missing root, `..` traversal, absolute paths, and symlink escape where Windows permissions allow symlink creation.
- [ ] Run `node --test tests/obsidian-listing.test.js`.
- [ ] Commit:

```powershell
git add src/obsidian-listing.js tests/obsidian-listing.test.js
git commit -m "feat: discover Obsidian listing files safely"
```

### Task 4: Add read-only server routes

- [ ] Inject `obsidianRoot`, `listObsidianBatches`, and `readObsidianBatch` through `createServer(options)`.
- [ ] Add `GET /api/obsidian/batches` and `POST /api/obsidian/batch` with body `{relativePath}`.
- [ ] Map validation errors to 400, missing files to 404, and root/filesystem failures to 500 without returning absolute paths.
- [ ] Add `/obsidian-publishing.js` to the static allowlist.
- [ ] Extend `tests/server.test.js` with dependency-injected success/error tests and assert that no Alibaba dependency is invoked.
- [ ] Run `node --test tests/server.test.js tests/obsidian-listing.test.js`.
- [ ] Commit:

```powershell
git add src/server.js tests/server.test.js
git commit -m "feat: expose read-only Obsidian batch routes"
```

### Task 5: Build the import and base-plan UI

- [ ] Create pure helpers:

```js
export function createObsidianPublishingState() {
  return { batches: [], batch: null, basePlanId: '', sourceProductId: '', error: '' };
}

export function remainingPlans(batch, basePlanId) {
  return batch.plans.filter((plan) => plan.id !== basePlanId);
}
```

- [ ] Test that any one of five plans can be selected and exactly four ordered variants remain.
- [ ] Add a left-navigation entry and `module-obsidian-publishing` section with refresh, file selection, batch validation summary, five-plan radio selection, and a local source-product-ID input. Do not call Alibaba yet.
- [ ] Initialize the controller from `public/app.js`; keep API calls inside the new controller.
- [ ] Add focused styles using existing tokens and responsive layout.
- [ ] Run `node --test tests/obsidian-publishing-ui.test.js tests/server.test.js`.
- [ ] Start the server and verify the module can import a fixture copied into the fixed Obsidian root, then stop the server.
- [ ] Commit:

```powershell
git add public/obsidian-publishing.js public/index.html public/styles.css public/app.js tests/obsidian-publishing-ui.test.js
git commit -m "feat: add Obsidian batch selection UI"
```

### Task 6: Document and verify Phase 1

- [ ] Document the fixed root, marker format, validation rules, and read-only boundary in `README.md`.
- [ ] Run `rg -n "schema\.add|schema\.add\.draft|photobank\.upload" src/obsidian-listing.js public/obsidian-publishing.js` and confirm no write method appears.
- [ ] Run `npm test`.
- [ ] Run `git diff --check` and `git status --short`.
- [ ] Commit:

```powershell
git add README.md
git commit -m "docs: explain Obsidian listing import"
```

## Phase 1 Acceptance

- The workbench finds valid Markdown batches only below the fixed Obsidian root.
- Invalid/old batches are blocked with a useful error.
- The user can choose the base plan and enter the existing Alibaba product ID locally.
- No Alibaba endpoint is called.

