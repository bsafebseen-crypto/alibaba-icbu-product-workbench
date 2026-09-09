import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginPublicationAttempt,
  beginDraftAttempt,
  failDraftAttempt,
  finishPublicationVerification,
  finishDraftAttempt,
  markPublicationAmbiguous,
  markPublicationReconciling,
  markPublicationUnresolved,
  rejectPublicationAttempt,
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

test('formal publication binds the exact preview, baseline and six expected images', () => {
  const publishing = beginPublicationAttempt(readyItem(), {
    fingerprint: 'hash-1',
    baselineProductIds: ['100', '101'],
    expectedImageIds: ['1', '2', '3', '4', '5', '6'],
    startedAt: 'start',
  });
  assert.deepEqual(publishing, {
    ...readyItem(),
    status: 'publishing',
    baselineProductIds: ['100', '101'],
    expectedImageIds: ['1', '2', '3', '4', '5', '6'],
    publicationStartedAt: 'start',
  });
  assert.throws(() => beginPublicationAttempt(readyItem(), {
    fingerprint: 'stale', baselineProductIds: [], expectedImageIds: ['1', '2', '3', '4', '5', '6'], startedAt: 'start',
  }), /预览已经变化/);
  assert.throws(() => beginPublicationAttempt(readyItem(), {
    fingerprint: 'hash-1', baselineProductIds: [], expectedImageIds: ['1'], startedAt: 'start',
  }), /6 张图片/);
});

test('formal publication can start from a verified preview after its draft was created', () => {
  const publishing = beginPublicationAttempt({
    ...readyItem(),
    status: 'draft_created',
    draftProductId: '1601946395256',
  }, {
    fingerprint: 'hash-1',
    baselineProductIds: ['100'],
    expectedImageIds: ['1', '2', '3', '4', '5', '6'],
    startedAt: 'start',
  });

  assert.equal(publishing.status, 'publishing');
  assert.equal(publishing.draftProductId, '1601946395256');
});

test('formal publication has explicit reconciling, verified, rejected and unresolved states', () => {
  const publishing = beginPublicationAttempt(readyItem(), {
    fingerprint: 'hash-1', baselineProductIds: [], expectedImageIds: ['1', '2', '3', '4', '5', '6'], startedAt: 'start',
  });
  const reconciling = markPublicationReconciling(publishing, {
    productId: '200', traceId: 'trace', requestId: 'request', nextCheckAt: 'next',
  });
  assert.equal(reconciling.status, 'reconciling');
  assert.equal(reconciling.publicationProductId, '200');
  assert.equal(finishPublicationVerification(reconciling, {
    productId: '200', verifiedAt: 'verified',
  }).status, 'published_verified');
  assert.equal(rejectPublicationAttempt(publishing, { code: 'INVALID', message: 'bad' }, 'done').status, 'publish_rejected');

  const ambiguous = markPublicationAmbiguous(reconciling, {
    candidateProductIds: ['201', '202'], nextCheckAt: 'later',
  });
  assert.equal(ambiguous.status, 'reconciliation_ambiguous');
  assert.equal(markPublicationUnresolved(ambiguous, {
    candidateProductIds: ['201', '202'], completedAt: 'done',
  }).status, 'reconciliation_unresolved');
});

test('formal publication cannot be submitted twice from any terminal or in-flight state', () => {
  for (const status of ['publishing', 'reconciling', 'published_verified', 'publish_rejected', 'reconciliation_ambiguous', 'reconciliation_unresolved']) {
    assert.throws(() => beginPublicationAttempt({ ...readyItem(), status }, {
      fingerprint: 'hash-1', baselineProductIds: [], expectedImageIds: ['1', '2', '3', '4', '5', '6'], startedAt: 'start',
    }), /当前状态不允许直接发布/);
  }
});
