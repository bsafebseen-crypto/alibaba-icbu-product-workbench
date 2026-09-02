const EMPTY_METRICS = {
  firstResponseMs: null,
  unanswered: false,
  unansweredMs: null,
  buyerMessageCount: 0,
  sellerMessageCount: 0,
  durationMs: 0,
  lastActiveTime: null,
};

export function calculateConversationMetrics(messages, now = Date.now()) {
  if (messages.length === 0) return { ...EMPTY_METRICS };

  for (const message of messages) {
    if (message.direction !== 'buyer' && message.direction !== 'seller') {
      throw new TypeError('message direction must be buyer or seller');
    }
    if (typeof message.sendTime !== 'number'
      || !Number.isFinite(message.sendTime) || message.sendTime < 0) {
      throw new TypeError('message sendTime must be a non-negative finite number');
    }
  }

  const ordered = [...messages].sort((a, b) => a.sendTime - b.sendTime
    || String(a.messageId).localeCompare(String(b.messageId)));
  const firstBuyerIndex = ordered.findIndex((item) => item.direction === 'buyer');
  const firstSellerAfterBuyer = firstBuyerIndex < 0 ? undefined
    : ordered.slice(firstBuyerIndex + 1).find((item) => item.direction === 'seller');
  const last = ordered.at(-1);
  return {
    firstResponseMs: firstSellerAfterBuyer
      ? firstSellerAfterBuyer.sendTime - ordered[firstBuyerIndex].sendTime : null,
    unanswered: last.direction === 'buyer',
    unansweredMs: last.direction === 'buyer' ? Math.max(0, now - last.sendTime) : null,
    buyerMessageCount: ordered.filter((item) => item.direction === 'buyer').length,
    sellerMessageCount: ordered.filter((item) => item.direction === 'seller').length,
    durationMs: ordered.length > 1 ? last.sendTime - ordered[0].sendTime : 0,
    lastActiveTime: last.sendTime,
  };
}
