const DELAYS_SECONDS = [2, 5, 10, 20, 30, 60, 300];
const PUBLISHED_STATUSES = new Set(['published', 'approved']);
const REVIEW_STATUSES = new Set(['new', 'auditing', 'modified', 'tbd', 'pending']);
const REJECTED_STATUSES = new Set(['untread', 'rejected', 'disapproved']);

export function next1688ReconciliationAt(now, attempt = 0) {
  const delay = DELAYS_SECONDS[Math.min(Math.max(0, Number(attempt) || 0), DELAYS_SECONDS.length - 1)];
  return new Date(new Date(now).getTime() + delay * 1000).toISOString();
}

function productId(product = {}) {
  const value = product.productID ?? product.productId ?? product.id ?? '';
  return String(value);
}

function normalizeStatus(product = {}) {
  return String(product.status || product.offerStatus || product.productStatus || '').trim().toLowerCase();
}

function identityMismatch(expected, product) {
  const actualCargo = String(product.cargoNumber || product.cargo_number || '');
  const actualCategory = String(product.categoryID ?? product.categoryId ?? '');
  const actualTitle = String(product.subject || product.title || '');
  return Boolean(
    (expected.cargoNumber && actualCargo && expected.cargoNumber !== actualCargo)
    || (expected.categoryId && actualCategory && expected.categoryId !== actualCategory)
    || (expected.title && actualTitle && expected.title !== actualTitle)
  );
}

function extractProducts(response = {}) {
  const result = response.result || response;
  const candidates = result.productInfos || result.products || result.resultList || result.items || [];
  return Array.isArray(candidates) ? candidates : [];
}

function applyProductResult(publication, response, product, now, attempts) {
  const id = productId(product) || String(publication.productId || '');
  if (identityMismatch(publication, product)) {
    return {
      ...publication,
      status: 'verification_failed',
      errorCode: 'IDENTITY_MISMATCH',
      errorMessage: '只读查询到的 1688 商品与发布前标题、货号或类目不一致',
      reconciliationAttempts: attempts,
      checkedAt: now,
    };
  }
  const status = normalizeStatus(product);
  const common = {
    ...publication,
    productId: id,
    offerStatus: status,
    reconciliationAttempts: attempts,
    checkedAt: now,
  };
  if (PUBLISHED_STATUSES.has(status)) {
    return { ...common, status: 'published_verified', verifiedAt: now, nextCheckAt: undefined };
  }
  if (REJECTED_STATUSES.has(status)) {
    return {
      ...common,
      status: 'verification_failed',
      errorCode: `OFFER_${status.toUpperCase()}`,
      errorMessage: response.errMsg || response.errorMessage || `1688 商品状态为 ${status}`,
      nextCheckAt: undefined,
    };
  }
  if (REVIEW_STATUSES.has(status) || status) {
    return {
      ...common,
      status: 'review_pending',
      nextCheckAt: next1688ReconciliationAt(now, attempts - 1),
    };
  }
  return {
    ...common,
    status: 'verify_pending',
    nextCheckAt: next1688ReconciliationAt(now, attempts - 1),
  };
}

export async function reconcile1688Publication(publication, api, now = new Date().toISOString()) {
  const attempts = Number(publication.reconciliationAttempts || 0) + 1;
  if (publication.productId) {
    try {
      const response = await api.getProduct(String(publication.productId));
      const product = response.productInfo || response.result?.productInfo || response.result || {};
      return applyProductResult(publication, response, product, now, attempts);
    } catch (error) {
      return {
        ...publication,
        status: publication.status === 'review_pending' ? 'review_pending' : 'verify_pending',
        errorCode: String(error.code || 'READONLY_QUERY_FAILED'),
        errorMessage: String(error.message || '1688 商品只读查询失败'),
        reconciliationAttempts: attempts,
        checkedAt: now,
        nextCheckAt: next1688ReconciliationAt(now, attempts - 1),
      };
    }
  }

  const startedAt = new Date(publication.startedAt);
  const startPublishTime = Number.isNaN(startedAt.getTime())
    ? undefined
    : new Date(startedAt.getTime() - 5 * 60 * 1000).toISOString();
  try {
    const response = await api.listProducts({
      pageNo: 1,
      pageSize: 20,
      cargoNumber: String(publication.cargoNumber || ''),
      categoryId: String(publication.categoryId || ''),
      startPublishTime,
      orderByCondition: 'CREATE_DATE',
      orderByType: 'DESC',
      needDetail: true,
    });
    const products = extractProducts(response);
    if (products.length === 1) {
      return applyProductResult(publication, response, products[0], now, attempts);
    }
    if (products.length > 1) {
      return {
        ...publication,
        status: 'verification_ambiguous',
        productId: '',
        candidateProductIds: products.map(productId).filter(Boolean),
        reconciliationAttempts: attempts,
        checkedAt: now,
        nextCheckAt: undefined,
      };
    }
    return {
      ...publication,
      status: 'uncertain',
      reconciliationAttempts: attempts,
      checkedAt: now,
      nextCheckAt: next1688ReconciliationAt(now, attempts - 1),
    };
  } catch (error) {
    return {
      ...publication,
      status: 'uncertain',
      errorCode: String(error.code || 'READONLY_QUERY_FAILED'),
      errorMessage: String(error.message || '1688 商品列表只读查询失败'),
      reconciliationAttempts: attempts,
      checkedAt: now,
      nextCheckAt: next1688ReconciliationAt(now, attempts - 1),
    };
  }
}
