import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConversationMetrics } from '../src/inquiry-metrics.js';

test('metrics calculate first response and current unanswered time from facts', () => {
  const result = calculateConversationMetrics([
    { messageId: 'm3', sendTime: 5000, direction: 'buyer' },
    { messageId: 'm1', sendTime: 1000, direction: 'buyer' },
    { messageId: 'm2', sendTime: 3000, direction: 'seller' },
  ], 9000);
  assert.deepEqual(result, {
    firstResponseMs: 2000, unanswered: true, unansweredMs: 4000,
    buyerMessageCount: 2, sellerMessageCount: 1, durationMs: 4000, lastActiveTime: 5000,
  });
});

test('metrics use null when no buyer message has received a seller response', () => {
  const result = calculateConversationMetrics([
    { messageId: 'm1', sendTime: 1000, direction: 'buyer' },
  ], 2000);
  assert.equal(result.firstResponseMs, null);
  assert.equal(result.unanswered, true);
});

test('metrics return the complete empty shape for no messages', () => {
  assert.deepEqual(calculateConversationMetrics([], 2000), {
    firstResponseMs: null, unanswered: false, unansweredMs: null,
    buyerMessageCount: 0, sellerMessageCount: 0, durationMs: 0, lastActiveTime: null,
  });
});

test('metrics sort equal timestamps by message id deterministically', () => {
  const result = calculateConversationMetrics([
    { messageId: 'b', sendTime: 1000, direction: 'seller' },
    { messageId: 'a', sendTime: 1000, direction: 'buyer' },
  ], 2000);
  assert.equal(result.firstResponseMs, 0);
  assert.equal(result.unanswered, false);
  assert.equal(result.lastActiveTime, 1000);
});

test('metrics reject invalid directions', () => {
  assert.throws(() => calculateConversationMetrics([
    { messageId: 'm1', sendTime: 1000, direction: 'unknown' },
  ]), /direction/);
});

test('metrics reject invalid send times', () => {
  for (const sendTime of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1000']) {
    assert.throws(() => calculateConversationMetrics([
      { messageId: 'm1', sendTime, direction: 'buyer' },
    ]), /sendTime/);
  }
});
