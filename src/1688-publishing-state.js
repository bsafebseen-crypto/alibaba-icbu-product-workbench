function requirePublishing(state) {
  if (state?.status !== 'publishing' || state.writeConsumed !== true) {
    throw new Error('只有正在发布的 1688 商品才能记录发布结果');
  }
}

export function mark1688Ready(state = {}, input = {}) {
  if (state.writeConsumed) throw new Error('当前商品已经提交过，不能重新生成可发布状态');
  if (!input.fingerprint) throw new Error('缺少 1688 发布请求指纹');
  if (!input.schemaHash) throw new Error('缺少 1688 发布规则版本');
  return {
    status: 'ready',
    fingerprint: String(input.fingerprint),
    schemaHash: String(input.schemaHash),
    writeConsumed: false,
    preparedAt: input.preparedAt,
  };
}

export function begin1688Publication(state = {}, input = {}) {
  if (state.writeConsumed) throw new Error('当前商品已经提交过，只允许进行只读核验');
  if (state.status !== 'ready') throw new Error('当前 1688 商品状态不允许发布');
  if (!input.fingerprint || input.fingerprint !== state.fingerprint) {
    throw new Error('1688 商品预览已经变化，请重新生成并确认');
  }
  if (!input.schemaHash || input.schemaHash !== state.schemaHash) {
    throw new Error('1688 商品发布规则已经变化，请重新读取规则并确认');
  }
  return {
    ...state,
    status: 'publishing',
    writeConsumed: true,
    startedAt: input.startedAt,
  };
}

export function finish1688Publication(state, result = {}, now) {
  requirePublishing(state);
  const productId = String(result.itemId || result.productId || '').trim();
  if (!productId) {
    return {
      ...state,
      status: 'uncertain',
      productId: '',
      requestId: String(result.requestId || ''),
      offerStatus: String(result.offerStatus || ''),
      errorCode: 'MISSING_PRODUCT_ID',
      errorMessage: '1688 发布接口未返回商品 ID，只能按唯一货号进行只读核验',
      uncertainAt: now,
    };
  }
  return {
    ...state,
    status: 'verify_pending',
    productId,
    requestId: String(result.requestId || ''),
    offerStatus: String(result.offerStatus || ''),
    returnedAt: now,
  };
}

export function fail1688Publication(state, error = {}, now) {
  requirePublishing(state);
  return {
    ...state,
    status: 'publish_failed',
    errorCode: String(error.code || ''),
    errorMessage: String(error.message || '1688 明确返回商品发布失败'),
    completedAt: now,
  };
}

export function mark1688PublicationUncertain(state, error = {}, now) {
  requirePublishing(state);
  return {
    ...state,
    status: 'uncertain',
    errorCode: String(error.code || ''),
    errorMessage: String(error.message || '1688 发布结果不确定，只允许只读核验'),
    uncertainAt: now,
  };
}

export function recover1688Publication(state = {}, now) {
  if (state.status !== 'publishing') return state;
  return {
    ...state,
    status: 'uncertain',
    errorCode: 'PROCESS_RESTARTED',
    errorMessage: '服务在发布结果确认前重启，只允许只读核验',
    uncertainAt: now,
  };
}
