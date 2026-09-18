import test from 'node:test';
import assert from 'node:assert/strict';

import {
  begin1688Publication,
  fail1688Publication,
  finish1688Publication,
  mark1688PublicationUncertain,
  mark1688Ready,
  recover1688Publication,
} from '../src/1688-publishing-state.js';

function draft() {
  return { status: 'draft', writeConsumed: false };
}

test('mark1688Ready binds the exact preview fingerprint and schema hash', () => {
  assert.deepEqual(mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  }), {
    status: 'ready',
    fingerprint: 'fp-1',
    schemaHash: 'schema-1',
    writeConsumed: false,
    preparedAt: 'prepared',
  });
});

test('begin1688Publication consumes the only write opportunity', () => {
  const ready = mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  });
  const publishing = begin1688Publication(ready, {
    fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'start',
  });

  assert.equal(publishing.status, 'publishing');
  assert.equal(publishing.writeConsumed, true);
  assert.equal(publishing.startedAt, 'start');
  assert.throws(() => begin1688Publication(publishing, {
    fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'again',
  }), /已经提交过|不允许发布/);
});

test('begin1688Publication blocks stale previews and changed schemas', () => {
  const ready = mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  });
  assert.throws(() => begin1688Publication(ready, {
    fingerprint: 'stale', schemaHash: 'schema-1', startedAt: 'start',
  }), /预览已经变化/);
  assert.throws(() => begin1688Publication(ready, {
    fingerprint: 'fp-1', schemaHash: 'schema-2', startedAt: 'start',
  }), /发布规则已经变化/);
});

test('successful writes enter verify_pending instead of claiming final success', () => {
  const publishing = begin1688Publication(mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  }), { fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'start' });
  const pending = finish1688Publication(publishing, {
    itemId: '706291373455', requestId: 'request-1', offerStatus: 'PUBLISHED',
  }, 'returned');

  assert.equal(pending.status, 'verify_pending');
  assert.equal(pending.productId, '706291373455');
  assert.equal(pending.writeConsumed, true);
  assert.equal(pending.verifiedAt, undefined);
});

test('a successful response without a product id becomes readonly uncertainty', () => {
  const publishing = begin1688Publication(mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  }), { fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'start' });
  const uncertain = finish1688Publication(publishing, {
    requestId: 'request-1', offerStatus: 'PUBLISHED',
  }, 'returned');

  assert.equal(uncertain.status, 'uncertain');
  assert.equal(uncertain.writeConsumed, true);
  assert.equal(uncertain.productId, '');
  assert.equal(uncertain.errorCode, 'MISSING_PRODUCT_ID');
  assert.match(uncertain.errorMessage, /只读核验/);
});

test('explicit failures and uncertain outcomes remain distinguishable and never restore write access', () => {
  const publishing = begin1688Publication(mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  }), { fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'start' });
  const failed = fail1688Publication(publishing, { code: 'CHK_TITLE', message: '标题错误' }, 'done');
  const uncertain = mark1688PublicationUncertain(publishing, { message: 'timeout' }, 'unknown');

  assert.equal(failed.status, 'publish_failed');
  assert.equal(failed.writeConsumed, true);
  assert.equal(uncertain.status, 'uncertain');
  assert.equal(uncertain.writeConsumed, true);
  assert.throws(() => begin1688Publication(uncertain, {
    fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'again',
  }), /已经提交过|不允许发布/);
});

test('recover1688Publication converts an interrupted publishing state to readonly uncertainty', () => {
  const publishing = begin1688Publication(mark1688Ready(draft(), {
    fingerprint: 'fp-1', schemaHash: 'schema-1', preparedAt: 'prepared',
  }), { fingerprint: 'fp-1', schemaHash: 'schema-1', startedAt: 'start' });

  assert.deepEqual(recover1688Publication(publishing, 'restart'), {
    ...publishing,
    status: 'uncertain',
    errorCode: 'PROCESS_RESTARTED',
    errorMessage: '服务在发布结果确认前重启，只允许只读核验',
    uncertainAt: 'restart',
  });
  assert.equal(recover1688Publication({ status: 'ready', writeConsumed: false }, 'restart').status, 'ready');
});
