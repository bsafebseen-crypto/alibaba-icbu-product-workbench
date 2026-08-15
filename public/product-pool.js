function text(value) {
  return String(value ?? '').trim();
}

function deriveIssues(product) {
  const issues = [];
  const title = text(product?.title);
  if (!title) issues.push('缺少标题');
  else if (title.length > 128) issues.push('标题超过 128 字符');
  if (Number(product?.faqCount || 0) < 5) issues.push('FAQ 不足 5 组');
  if (Number(product?.customAttributeCount || 0) < 1) issues.push('缺少自定义属性');
  if (product?.imageReady !== true) issues.push('图片银行未完成');
  if (!product?.hasPreview || !product?.previewFields?.includes('images')) {
    issues.push('尚未生成完整预览');
  }
  return issues;
}

function deriveStage(product, issues) {
  if (issues.some((issue) => [
    '缺少标题', '标题超过 128 字符', 'FAQ 不足 5 组', '缺少自定义属性',
  ].includes(issue))) return 'needs-content';
  if (product?.imageReady !== true) return 'needs-images';
  if (!product?.hasPreview || !product?.previewFields?.includes('images')) return 'needs-preview';
  return 'preview-ready';
}

export function buildProductRows(tasks) {
  return (Array.isArray(tasks) ? tasks : []).flatMap((task) => (
    (Array.isArray(task?.products) ? task.products : []).map((product) => {
      const issues = deriveIssues(product);
      return {
        taskId: text(task?.id),
        title: text(product?.title),
        sourceProductId: text(task?.sourceProductId),
        productIndex: Number(product?.index || 0),
        mode: text(task?.mode || 'manual'),
        updatedAt: text(task?.updatedAt || task?.createdAt),
        contentReady: !issues.some((issue) => [
          '缺少标题', '标题超过 128 字符', 'FAQ 不足 5 组', '缺少自定义属性',
        ].includes(issue)),
        imageReady: product?.imageReady === true,
        schemaReady: Boolean(product?.hasPreview),
        stage: deriveStage(product, issues),
        issues,
      };
    })
  ));
}

export function filterProductRows(rows, query = '', stage = 'all') {
  const needle = text(query).toLocaleLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (stage !== 'all' && row?.stage !== stage) return false;
    if (!needle) return true;
    return [row?.taskId, row?.title, row?.sourceProductId]
      .some((value) => text(value).toLocaleLowerCase().includes(needle));
  });
}

export function sortProductRows(rows, sortKey = 'updatedAt', direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => (
    text(left?.[sortKey]).localeCompare(text(right?.[sortKey]), 'zh-CN') * multiplier
  ));
}

export function summarizeDashboard(tasks, rows) {
  const products = Array.isArray(rows) ? rows : [];
  const readyCount = products.filter((row) => row?.stage === 'preview-ready').length;
  return {
    batchCount: Array.isArray(tasks) ? tasks.length : 0,
    productCount: products.length,
    readyCount,
    needsAttentionCount: products.length - readyCount,
  };
}
