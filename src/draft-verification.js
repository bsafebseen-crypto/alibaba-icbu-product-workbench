function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareDraftToPlan(plan = {}, analysis = {}) {
  const recognized = analysis.recognized || {};
  const expectedFaqs = Array.isArray(plan.faqs) ? plan.faqs : [];
  const actualFaqs = Array.isArray(recognized.faq?.items) ? recognized.faq.items.slice(0, 5) : [];
  const expectedAttributes = Array.isArray(plan.customAttributes) ? plan.customAttributes : [];
  const actualAttributes = Array.isArray(recognized.customAttributes?.items)
    ? recognized.customAttributes.items
    : [];
  const images = Array.isArray(recognized.images?.items) ? recognized.images.items : [];
  const completeImageMetadata = images.every((image) => (
    String(image?.fileId || '').trim() && String(image?.url || '').trim()
  ));
  const fields = {
    title: {
      match: String(recognized.title?.value || '') === String(plan.title || ''),
      expected: String(plan.title || ''),
      actual: String(recognized.title?.value || ''),
    },
    sellingPoints: {
      match: String(recognized.productSummary?.value || '') === String(plan.sellingPoints || ''),
      expected: String(plan.sellingPoints || ''),
      actual: String(recognized.productSummary?.value || ''),
    },
    faqs: {
      match: expectedFaqs.length === 5 && equal(actualFaqs, expectedFaqs),
      expectedCount: expectedFaqs.length,
      actualCount: actualFaqs.length,
    },
    customAttributes: {
      match: expectedAttributes.length === 10 && equal(actualAttributes, expectedAttributes),
      expectedCount: expectedAttributes.length,
      actualCount: actualAttributes.length,
    },
    images: {
      match: images.length === 6 && completeImageMetadata,
      expectedCount: 6,
      actualCount: images.length,
      completeMetadata: completeImageMetadata,
    },
  };
  const differences = Object.entries(fields)
    .filter(([, result]) => !result.match)
    .map(([name]) => name);
  return { exactMatch: differences.length === 0, fields, differences };
}
