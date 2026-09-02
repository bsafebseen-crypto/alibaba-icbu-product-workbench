# Task 3: Deterministic inquiry metrics

## Scope

Added the dependency-free `calculateConversationMetrics(messages, now)` module and focused tests. The function copies and sorts normalized messages by `sendTime`, then `messageId`, validates each direction and timestamp, and returns deterministic response, unanswered, count, duration, and activity metrics.

## TDD evidence

### RED

Created `tests/inquiry-metrics.test.js` before the production module and ran:

```text
node --test tests/inquiry-metrics.test.js
```

Result: failed as expected with `ERR_MODULE_NOT_FOUND` for `src/inquiry-metrics.js`.

### GREEN

Implemented `src/inquiry-metrics.js`, including:

- complete null/zero shape for empty input;
- first seller response after the first buyer message;
- current unanswered duration only when the last message is from the buyer;
- buyer/seller counts, conversation duration, and last activity time;
- rejection of directions other than `buyer`/`seller`;
- rejection of non-number, negative, `NaN`, and infinite `sendTime` values;
- non-mutating deterministic ordering.

Focused verification:

```text
node --test tests/inquiry-metrics.test.js
```

Result: 6 tests passed, 0 failed.

## Full-suite evidence

```text
npm test
```

Result: 222 tests passed, 0 failed.

## Self-review

Only the requested module and tests were added. No network calls, credentials, or sensitive data are involved. Existing untracked `data/` content was left untouched.

## Commit

`feat: calculate inquiry response metrics`
