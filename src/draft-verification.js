function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function attributeDifferenceDetails(expected, actual) {
  const expectedByName = new Map(expected.map((item) => [String(item?.name || ''), item]));
  const actualByName = new Map(actual.map((item) => [String(item?.name || ''), item]));
  return {
    orderMatch: equal(
      expected.map((item) => String(item?.name || '')),
      actual.map((item) => String(item?.name || '')),
    ),
    missing: expected
      .filter((item) => !actualByName.has(String(item?.name || '')))
      .map((item) => ({ name: String(item.name || ''), value: String(item.value || '') })),
    unexpected: actual
      .filter((item) => !expectedByName.has(String(item?.name || '')))
      .map((item) => ({ name: String(item.name || ''), value: String(item.value || '') })),
    changed: expected.flatMap((item) => {
      const name = String(item?.name || '');
      const actualItem = actualByName.get(name);
      if (!actualItem || String(actualItem.value || '') === String(item.value || '')) return [];
      return [{
        name,
        expectedValue: String(item.value || ''),
        actualValue: String(actualItem.value || ''),
      }];
    }),
  };
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
  const attributeDetails = attributeDifferenceDetails(expectedAttributes, actualAttributes);
  const customAttributesMatch = expectedAttributes.length === 10
    && actualAttributes.length === 10
    && attributeDetails.missing.length === 0
    && attributeDetails.unexpected.length === 0
    && attributeDetails.changed.length === 0;
  const customAttributesResult = {
    match: customAttributesMatch,
    expectedCount: expectedAttributes.length,
    actualCount: actualAttributes.length,
    ...(customAttributesMatch && !attributeDetails.orderMatch ? { orderChanged: true } : {}),
    ...(!customAttributesMatch ? { details: attributeDetails } : {}),
  };
  const sellingPointFieldConfirmed = recognized.productSummary?.confirmed !== false;
  const fields = {
    title: {
      match: String(recognized.title?.value || '') === String(plan.title || ''),
      expected: String(plan.title || ''),
      actual: String(recognized.title?.value || ''),
    },
    sellingPoints: {
      match: sellingPointFieldConfirmed
        && String(recognized.productSummary?.value || '') === String(plan.sellingPoints || ''),
      expected: String(plan.sellingPoints || ''),
      actual: String(recognized.productSummary?.value || ''),
      ...(!sellingPointFieldConfirmed ? { fieldConfirmed: false } : {}),
    },
    faqs: {
      match: expectedFaqs.length === 5 && equal(actualFaqs, expectedFaqs),
      expectedCount: expectedFaqs.length,
      actualCount: actualFaqs.length,
    },
    customAttributes: customAttributesResult,
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
