# Trusted Automatic Alibaba Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the user verifies and accepts one successful four-draft batch, allow one-click sequential formal publication of a new four-product batch without per-product confirmation.

**Architecture:** A local trusted-mode record is unlocked only from a verified accepted draft task. A server-side run queue snapshots four current fingerprints, then publishes one item per explicit `next` request initiated automatically by the active browser. This avoids background publishing, isolates results, and stops on the first failure or unknown outcome.

**Tech Stack:** Node.js 20+, native `fetch`, local atomic JSON state, browser JavaScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-obsidian-similar-product-publishing-design.md`

## Global Constraints

- Do not add formal publish until a four-item draft task is verified and explicitly accepted by the user.
- Trusted mode is local, scoped to the Alibaba account/app identity and publish-context signature, and never committed.
- One batch-start confirmation is allowed; no per-product confirmation in trusted mode.
- No filesystem watcher, scheduler, background daemon, auto retry, or continue-after-error.
- A changed account, app key, category, language, publish type, schema version, or preview fingerprint locks the mode again.
- Automated tests mock all Alibaba calls; real formal publication is always user-initiated in the workbench.

## File and Responsibility Map

- `src/trusted-publish-mode.js`: acceptance evidence and eligibility decisions.
- `src/publishing-settings.js`: sanitized atomic local trusted-mode record.
- `src/publishing-run.js`: four-item sequential run state.
- `src/alibaba-client.js`: single formal `schema.add` call.
- `src/server.js`: accept/unlock/start/next/status routes.
- `public/obsidian-publishing.js`: trusted-mode controls and active-run loop.
- `tests/trusted-publish-mode.test.js`, `tests/publishing-settings.test.js`, `tests/publishing-run.test.js`, `tests/alibaba-client.test.js`, `tests/server.test.js`: safety coverage.
- `AGENTS.md`, `README.md`: final scoped authorization and operator runbook.

## Interfaces

```js
export function createDraftAcceptance(task, userAcknowledgement, now) {}
export function evaluateTrustedMode(record, context) {}
export function createPublishingRun(task, currentPreviews, now) {}
export function nextPublishingItem(run) {}
export async function publishAlibabaProduct(config, { schemaXml, publishContext }, fetchImpl, timestamp) {}
```

Run states are `ready`, `running`, `completed`, `stopped_failed`, and `stopped_unknown`; item states are `pending`, `submitting`, `published`, `failed`, and `result_unknown`.

### Task 1: Model draft acceptance and trusted eligibility

- [ ] Add failing tests requiring exactly four distinct `draft_created` items with Alibaba IDs and an explicit acknowledgement string `我已在阿里后台核对4个草稿`.
- [ ] Bind acceptance to account/app identity hash and `{categoryId,language,publishType,version}` signature without storing credentials.
- [ ] Test rejection for incomplete drafts, repeated IDs, unknown results, wrong acknowledgement, and changed context.
- [ ] Implement `createDraftAcceptance` and `evaluateTrustedMode`.
- [ ] Run `node --test tests/trusted-publish-mode.test.js`.
- [ ] Commit:

```powershell
git add src/trusted-publish-mode.js tests/trusted-publish-mode.test.js
git commit -m "feat: require verified draft acceptance for trusted mode"
```

### Task 2: Persist the local trusted-mode record

- [ ] Store the record under ignored local data, using atomic write/rename and restrictive file permissions where supported.
- [ ] Persist only hashes, context signature, accepted task ID, activation time, and enabled flag.
- [ ] Add `readTrustedMode`, `writeTrustedMode`, and `disableTrustedMode` with tests for corruption, missing file, and sanitization.
- [ ] Ensure `.gitignore` covers the settings file and test `git status --short` after creating a fixture record locally.
- [ ] Run `node --test tests/publishing-settings.test.js`.
- [ ] Commit:

```powershell
git add src/publishing-settings.js tests/publishing-settings.test.js .gitignore
git commit -m "feat: store trusted publishing permission locally"
```

### Task 3: Implement the resumable-but-not-retrying run state

- [ ] Add tests that snapshot exactly four plan IDs and fingerprints, publish in order, stop after explicit failure, and stop/lock after an unknown result.
- [ ] Prevent starting another run while one is `ready` or `running`.
- [ ] Permit status inspection after browser restart, but require the user to explicitly resume only when the prior item has a definitive result; never resume `result_unknown`.
- [ ] Implement pure run transitions and version each persisted update.
- [ ] Run `node --test tests/publishing-run.test.js`.
- [ ] Commit:

```powershell
git add src/publishing-run.js tests/publishing-run.test.js
git commit -m "feat: sequence trusted four-product publishing runs"
```

### Task 4: Add the formal publish client call

- [ ] Add failing client tests asserting method `alibaba.icbu.product.schema.add` and the same resolved request envelope used by the accepted draft stage.
- [ ] Implement one formal publish call; normalize product ID, business success, message, message code, request ID, and trace ID.
- [ ] Distinguish explicit business failure from unknown network/protocol outcome.
- [ ] Run `node --test tests/alibaba-client.test.js`.
- [ ] Commit:

```powershell
git add src/alibaba-client.js tests/alibaba-client.test.js
git commit -m "feat: publish one Alibaba product formally"
```

### Task 5: Add guarded acceptance and run routes

- [ ] Add `POST /api/obsidian/draft-batch/accept` requiring the exact acknowledgement and re-reading the four successful stored draft items.
- [ ] Add `POST /api/obsidian/trusted-mode/enable` and `/disable`; enabling must recompute eligibility.
- [ ] Add `POST /api/obsidian/formal-run/start`, `POST /api/obsidian/formal-run/next`, and `GET /api/obsidian/formal-run/status`.
- [ ] At start, recompute all four previews and fingerprints, capability, account hash, and context signature. Snapshot them before returning the run ID.
- [ ] At next, publish exactly one pending item, atomically store its result, and stop on failure/unknown.
- [ ] Add route tests for every lock condition, stale preview, double start, double next, partial success, explicit failure, timeout, and complete run.
- [ ] Run `node --test tests/server.test.js tests/publishing-run.test.js tests/trusted-publish-mode.test.js`.
- [ ] Commit:

```powershell
git add src/server.js tests/server.test.js
git commit -m "feat: guard trusted formal publishing runs"
```

### Task 6: Add trusted-mode and one-click batch UI

- [ ] Add draft-batch acceptance UI showing the four verified draft IDs and requiring the exact acknowledgement phrase once.
- [ ] Show trusted mode as locked/enabled with the bound account/context and a disable button.
- [ ] Add one batch-start confirmation listing all four titles. After confirmation, start a run and call `next` sequentially while the page remains active.
- [ ] Render each product's definite Alibaba result before proceeding; stop immediately on failure or unknown outcome.
- [ ] Do not automatically start a new batch when Obsidian files change.
- [ ] Add UI tests for locked/enabled states, one confirmation, ordered next calls, stop behavior, and no background restart.
- [ ] Run `node --test tests/obsidian-publishing-ui.test.js`.
- [ ] Commit:

```powershell
git add public/obsidian-publishing.js public/styles.css tests/obsidian-publishing-ui.test.js
git commit -m "feat: add one-click trusted four-product publishing"
```

### Task 7: Authorize the narrow formal-write boundary and verify

- [ ] Update `AGENTS.md` to permit `schema.add` only through the trusted-mode/run gates above; explicitly keep all other product-write paths prohibited.
- [ ] Update `README.md` with activation, automatic relock conditions, result-unknown handling, and emergency disable steps.
- [ ] Run `rg -n "schema\.add" src public` and audit every match against the guarded client and routes.
- [ ] Run `npm test`, `git diff --check`, and `git status --short`.
- [ ] Exercise a fully mocked four-product run locally. Do not perform a real formal publish as part of automated acceptance.
- [ ] Commit:

```powershell
git add AGENTS.md README.md
git commit -m "docs: authorize trusted Alibaba publishing boundary"
```

## Phase 4 Acceptance

- Trusted mode cannot activate without one user-accepted, verified four-draft batch.
- One user click starts exactly four sequential formal submissions with no per-item prompts.
- Any drift, failure, or unknown result stops and/or locks the workflow.
- Nothing watches Obsidian or publishes in the background.
- A real formal batch is attempted only after the user deliberately starts it.

