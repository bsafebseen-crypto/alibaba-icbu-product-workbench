import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginDraftAttempt,
  failDraftAttempt,
  finishDraftAttempt,
  markDraftResultUnknown,
} from '../src/publishing-state.js';

function readyItem() {
  return { planId: 'plan-1', fingerprint: 'hash-1', status: 'preview_ready' };
}

test('beginDraftAttempt binds submission to the current preview fingerprint', () => {
  assert.deepEqual(beginDraftAttempt(readyItem(), 'hash-1', '2026-08-25T10:00:00.000Z'), {
    planId: 'plan-1',
    fingerprint: 'hash-1',
    status: 'submitting',
    attemptStartedAt: '2026-08-25T10:00:00.000Z',
  });
  assert.throws(() => beginDraftAttempt(readyItem(), 'stale', 'now'), /预览已经变化/);
});

test('beginDraftAttempt blocks duplicate and unknown-result submissions', () => {
  for (const status of ['submitting', 'draft_created', 'result_unknown']) {
    assert.throws(
      () => beginDraftAttempt({ ...readyItem(), status }, 'hash-1', 'now'),
      /当前状态不允许再次创建草稿/,
    );
  }
});

test('finishDraftAttempt records the returned draft id and trace id', () => {
  const submitting = beginDraftAttempt(readyItem(), 'hash-1', 'start');
  assert.deepEqual(finishDraftAttempt(submitting, {
    productId: '987654321', traceId: 'trace-1', requestId: 'request-1',
  }, 'finish'), {
    ...submitting,
    status: 'draft_created',
    draftProductId: '987654321',
    traceId: 'trace-1',
    requestId: 'request-1',
    completedAt: 'finish',
  });
});

test('failed and unknown draft outcomes remain distinguishable', () => {
  const submitting = beginDraftAttempt(readyItem(), 'hash-1', 'start');
  assert.equal(failDraftAttempt(submitting, { code: 'INVALID', message: 'bad field' }, 'finish').status, 'failed');
  assert.equal(markDraftResultUnknown(submitting, { message: 'timeout' }, 'finish').status, 'result_unknown');
});
