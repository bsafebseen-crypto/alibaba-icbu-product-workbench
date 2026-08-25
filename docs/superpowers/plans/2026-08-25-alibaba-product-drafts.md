# Alibaba Product Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user create four Alibaba product drafts one at a time from validated previews, with explicit confirmation, duplicate protection, and recoverable local status.

**Architecture:** A narrow Alibaba client wrapper owns `schema.add.draft`. A local state machine binds each plan to its preview fingerprint and records only sanitized IDs/statuses. The browser presents one confirmation per product and never retries an unknown result automatically.

**Tech Stack:** Node.js 20+, native `fetch`, native `crypto`, JSON files under `data/`, browser JavaScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-obsidian-similar-product-publishing-design.md`

## Global Constraints

- This phase may call `alibaba.icbu.product.schema.add.draft` only from the new guarded route after a per-product confirmation.
- Formal `alibaba.icbu.product.schema.add` remains prohibited.
- Check `alibaba.icbu.product.type.available.get` before enabling writes.
- Never store access tokens, secrets, full schema XML, preview XML, image bytes, or Markdown bodies.
- Never auto-retry a timeout or unknown Alibaba result.
- Automated tests must mock every Alibaba call; real writes happen only through the user's UI action.

## File and Responsibility Map

- `src/alibaba-client.js`: capability check and single draft call.
- `src/publishing-state.js`: fingerprint-bound state transitions and duplicate protection.
- `src/obsidian-task-store.js`: atomic sanitized local persistence.
- `src/server.js`: guarded capability/create-draft routes.
- `public/obsidian-publishing.js`: confirmations and item status.
- `tests/alibaba-client.test.js`, `tests/publishing-state.test.js`, `tests/obsidian-task-store.test.js`, `tests/server.test.js`: safety tests.
- `AGENTS.md`, `README.md`: narrowly authorize and document the draft stage.

## Interfaces

```js
export async function getAlibabaPublishingCapability(config, { categoryId, language }, fetchImpl, timestamp) {}
export async function createAlibabaProductDraft(config, { schemaXml, publishContext }, fetchImpl, timestamp) {}
// => { bizSuccess, productId, message, msgCode, traceId }

export function beginDraftAttempt(item, fingerprint, now) {}
export function finishDraftAttempt(item, result, now) {}
export function failDraftAttempt(item, error, now) {}
export function markDraftResultUnknown(item, error, now) {}
```

Allowed item states are `preview_ready`, `submitting`, `draft_created`, `failed`, and `result_unknown`.

### Task 1: Update the safety policy before adding the write path

- [ ] Amend `AGENTS.md` to allow only `schema.add.draft` in the Obsidian module, only with current preview fingerprint plus per-product user confirmation; retain the formal-publish prohibition.
- [ ] Add `tests/publishing-state.test.js` with failing transition and duplicate-submission tests.
- [ ] Run `node --test tests/publishing-state.test.js` and confirm failure.
- [ ] Commit:

```powershell
git add AGENTS.md tests/publishing-state.test.js
git commit -m "test: define guarded draft publishing states"
```

### Task 2: Implement fingerprint-bound draft state

- [ ] Implement legal transitions and reject submission if the stored preview fingerprint differs from the submitted fingerprint.
- [ ] Reject `submitting`, `draft_created`, and `result_unknown` items; only a deliberate user reset may move `failed` back to `preview_ready`.
- [ ] Treat network timeout, connection reset, invalid JSON, or missing business outcome as `result_unknown`; treat an explicit Alibaba business failure as `failed`.
- [ ] Add tests for every transition and repeat attempt.
- [ ] Run `node --test tests/publishing-state.test.js`.
- [ ] Commit:

```powershell
git add src/publishing-state.js tests/publishing-state.test.js
git commit -m "feat: guard draft submissions by preview fingerprint"
```

### Task 3: Persist sanitized task status atomically

- [ ] Implement task creation/read/update using a temporary file plus rename in the existing local `data/tasks` area.
- [ ] Persist only batch ID, relative source path, base plan ID, source product ID, publish-context summary, plan ID, fingerprint, status, returned product/draft ID, trace ID, error code, and timestamps.
- [ ] Add a recursive deny-list assertion for keys matching `token|secret|schemaXml|previewXml|imageBytes|dataUrl|markdown`.
- [ ] Test interrupted writes, missing task, concurrent version mismatch, and sanitization.
- [ ] Run `node --test tests/obsidian-task-store.test.js`.
- [ ] Commit:

```powershell
git add src/obsidian-task-store.js tests/obsidian-task-store.test.js
git commit -m "feat: persist sanitized Obsidian publishing status"
```

### Task 4: Add capability and draft client calls

- [ ] Add failing client tests that assert the official method names and payload fields.
- [ ] Implement capability normalization for `support_post_sourcing` and `support_post_whole_sale`; block when neither supports the resolved publish type.
- [ ] Implement one `schema.add.draft` call with:

```js
{
  param_product_top_publish_request: {
    publish_type: publishContext.publishType,
    xml: schemaXml,
    cat_id: publishContext.categoryId,
    language: publishContext.language,
    ...(publishContext.version ? { version: publishContext.version } : {})
  }
}
```

- [ ] Normalize `product_id`, `biz_success`, `message`, `msg_code`, and `trace_id`; throw on `biz_success !== true` without losing trace data.
- [ ] Run `node --test tests/alibaba-client.test.js`.
- [ ] Commit:

```powershell
git add src/alibaba-client.js tests/alibaba-client.test.js
git commit -m "feat: create one Alibaba product draft"
```

### Task 5: Add guarded server routes

- [ ] Add `POST /api/obsidian/publish-capability` as a read-only check.
- [ ] Add `POST /api/obsidian/draft` accepting `{config,taskId,planId,fingerprint,confirmed}`.
- [ ] Require `confirmed === true`, re-read the current task, rebuild or retrieve the transient current preview in memory, recompute its fingerprint, transition to `submitting`, then make exactly one client call.
- [ ] Persist `draft_created`, `failed`, or `result_unknown` before responding.
- [ ] Never accept preview XML directly as the authority for a write; bind the route to server-generated preview state for the active run.
- [ ] Add tests for missing confirmation, stale fingerprint, repeat click, capability failure, business failure, timeout, unknown result, and success.
- [ ] Assert `schema.add` is never invoked.
- [ ] Run `node --test tests/server.test.js tests/publishing-state.test.js tests/obsidian-task-store.test.js`.
- [ ] Commit:

```powershell
git add src/server.js tests/server.test.js
git commit -m "feat: guard Alibaba draft creation routes"
```

### Task 6: Add per-product draft controls

- [ ] Show four independent status cards and enable a draft button only for `preview_ready`.
- [ ] Before each call, show `window.confirm` with plan name, title, source product ID, and the words “将创建阿里国际站商品草稿”.
- [ ] Disable the button immediately, render the returned draft/product ID and trace ID, and never trigger the next item automatically.
- [ ] For `result_unknown`, show “不要重试；先去阿里后台按标题/时间核对” and provide no automatic reset.
- [ ] Add UI tests for all states and double-click suppression.
- [ ] Run `node --test tests/obsidian-publishing-ui.test.js`.
- [ ] Commit:

```powershell
git add public/obsidian-publishing.js public/styles.css tests/obsidian-publishing-ui.test.js
git commit -m "feat: confirm and create drafts one product at a time"
```

### Task 7: Verify and hand off the real draft test

- [ ] Update `README.md` with exact draft behavior, result-unknown recovery, and data not persisted.
- [ ] Run `npm test`, `git diff --check`, and `git status --short`.
- [ ] Start the workbench and complete read-only preview preparation.
- [ ] Hand control to the user for the first real draft click; after each result, verify the returned ID in Alibaba's backend before creating the next draft.
- [ ] Commit documentation before any real write:

```powershell
git add README.md
git commit -m "docs: explain guarded Alibaba draft testing"
```

## Phase 3 Acceptance

- Capability check passes for the source category and publishing type.
- Each of four drafts requires a separate explicit confirmation.
- Success records an Alibaba ID; ambiguous results block retries.
- The user verifies one complete four-draft batch in Alibaba's backend.
- Formal publish remains locked.

