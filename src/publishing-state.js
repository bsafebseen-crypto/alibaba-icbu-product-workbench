function requireSubmitting(item) {
  if (item?.status !== 'submitting') throw new Error('草稿结果只能写入正在提交的商品');
}

export function beginDraftAttempt(item, fingerprint, now) {
  if (item?.status !== 'preview_ready') throw new Error('当前状态不允许再次创建草稿');
  if (!fingerprint || item.fingerprint !== fingerprint) throw new Error('预览已经变化，请重新生成并确认');
  return { ...item, status: 'submitting', attemptStartedAt: now };
}

export function finishDraftAttempt(item, result, now) {
  requireSubmitting(item);
  const draftProductId = String(result?.productId || '').trim();
  if (!draftProductId) throw new Error('阿里未返回商品草稿 ID');
  return {
    ...item,
    status: 'draft_created',
    draftProductId,
    traceId: result.traceId || '',
    requestId: result.requestId || '',
    completedAt: now,
  };
}

export function failDraftAttempt(item, error, now) {
  requireSubmitting(item);
  return {
    ...item,
    status: 'failed',
    errorCode: error?.code || '',
    errorMessage: error?.message || '阿里明确返回草稿创建失败',
    completedAt: now,
  };
}

export function markDraftResultUnknown(item, error, now) {
  requireSubmitting(item);
  return {
    ...item,
    status: 'result_unknown',
    errorCode: error?.code || '',
    errorMessage: error?.message || '草稿创建结果未知',
    completedAt: now,
  };
}
