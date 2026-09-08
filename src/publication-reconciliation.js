const DELAYS = [2000, 5000, 10000, 20000, 30000, 60000];
const FIVE_MINUTES = 300000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function reconciliationDelayMs(attemptNumber, elapsedMs = 0) {
  if (Number(elapsedMs) >= ONE_DAY) return null;
  const attempt = Math.max(0, Number.isInteger(attemptNumber) ? attemptNumber : 0);
  return DELAYS[attempt] ?? FIVE_MINUTES;
}

function numericIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d+$/.test(value)))];
}

export async function reconcilePublication(dependencies = {}, input = {}) {
  const {
    listAlibabaProducts,
    loadAlibabaProductContext,
    analyzeProductSchema,
    comparePublishedProductToPlan,
  } = dependencies;
  const item = input.item || {};
  const returnedId = /^\d+$/.test(String(item.publicationProductId || '').trim())
    ? String(item.publicationProductId).trim()
    : '';
  let candidateProductIds = returnedId ? [returnedId] : [];

  if (!returnedId) {
    try {
      const listed = await listAlibabaProducts(input.config, {
        subject: input.plan?.title,
        categoryId: input.categoryId,
        modifiedFrom: item.publicationStartedAt,
        modifiedTo: input.now,
        pageSize: 30,
      });
      const baseline = new Set(numericIds(item.baselineProductIds));
      candidateProductIds = numericIds((listed?.products || []).map((product) => product?.productId))
        .filter((productId) => !baseline.has(productId));
    } catch {
      return { kind: 'pending', candidateProductIds };
    }
  }

  const exactProductIds = [];
  for (const productId of candidateProductIds) {
    try {
      const product = await loadAlibabaProductContext(input.config, { productId });
      const analysis = analyzeProductSchema(product.schemaXml, {
        sellingPointBinding: input.sellingPointBinding,
      });
      const comparison = comparePublishedProductToPlan(
        input.plan,
        analysis,
        item.expectedImageIds,
      );
      if (comparison.exactMatch) exactProductIds.push(productId);
    } catch {
      // Alibaba may index a newly published product after schema.add returns.
    }
  }

  if (exactProductIds.length === 1) {
    return { kind: 'verified', productId: exactProductIds[0], candidateProductIds: exactProductIds };
  }
  if (exactProductIds.length > 1) {
    return { kind: 'ambiguous', candidateProductIds: exactProductIds };
  }
  return { kind: 'pending', candidateProductIds };
}
