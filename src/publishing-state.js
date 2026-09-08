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

function requirePublicationStatus(item, allowed, message) {
  if (!allowed.includes(item?.status)) throw new Error(message);
}

function safeIdList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}无效`);
  const ids = value.map((id) => String(id || '').trim());
  if (ids.some((id) => !/^\d+$/.test(id))) throw new Error(`${label}无效`);
  return [...new Set(ids)];
}

export function beginPublicationAttempt(item, input = {}) {
  if (item?.status !== 'preview_ready') throw new Error('当前状态不允许直接发布');
  if (!input.fingerprint || item.fingerprint !== input.fingerprint) throw new Error('预览已经变化，请重新生成并确认');
  const expectedImageIds = safeIdList(input.expectedImageIds, '预期图片');
  if (expectedImageIds.length !== 6) throw new Error('正式发布必须包含 6 张图片');
  return {
    ...item,
    status: 'publishing',
    baselineProductIds: safeIdList(input.baselineProductIds, '基线商品'),
    expectedImageIds,
    publicationStartedAt: input.startedAt,
  };
}

export function markPublicationReconciling(item, input = {}) {
  requirePublicationStatus(item, ['publishing', 'reconciling', 'reconciliation_ambiguous'], '当前状态不能进入发布对账');
  return Object.fromEntries(Object.entries({
    ...item,
    status: 'reconciling',
    publicationProductId: input.productId || item.publicationProductId,
    candidateProductIds: input.candidateProductIds
      ? safeIdList(input.candidateProductIds, '候选商品')
      : item.candidateProductIds,
    traceId: input.traceId || item.traceId,
    requestId: input.requestId || item.requestId,
    errorCode: input.error?.code || item.errorCode,
    errorMessage: input.error?.message || item.errorMessage,
    nextCheckAt: input.nextCheckAt,
  }).filter(([, value]) => value !== undefined && value !== ''));
}

export function finishPublicationVerification(item, input = {}) {
  requirePublicationStatus(item, ['reconciling', 'reconciliation_ambiguous'], '只有对账中的商品才能确认发布成功');
  const [productId] = safeIdList([input.productId], '正式商品');
  return {
    ...item,
    status: 'published_verified',
    publicationProductId: productId,
    traceId: input.traceId || item.traceId || '',
    requestId: input.requestId || item.requestId || '',
    verifiedAt: input.verifiedAt,
  };
}

export function rejectPublicationAttempt(item, error, now) {
  requirePublicationStatus(item, ['publishing'], '只有正在发布的商品才能记录明确失败');
  return {
    ...item,
    status: 'publish_rejected',
    errorCode: error?.code || '',
    errorMessage: error?.message || '阿里明确返回正式发布失败',
    completedAt: now,
  };
}

export function markPublicationAmbiguous(item, input = {}) {
  requirePublicationStatus(item, ['reconciling'], '只有对账中的商品才能标记为候选不唯一');
  return {
    ...item,
    status: 'reconciliation_ambiguous',
    candidateProductIds: safeIdList(input.candidateProductIds, '候选商品'),
    nextCheckAt: input.nextCheckAt,
  };
}

export function markPublicationUnresolved(item, input = {}) {
  requirePublicationStatus(item, ['reconciling', 'reconciliation_ambiguous'], '只有对账中的商品才能标记为未解决');
  return {
    ...item,
    status: 'reconciliation_unresolved',
    candidateProductIds: safeIdList(input.candidateProductIds || [], '候选商品'),
    completedAt: input.completedAt,
  };
}
