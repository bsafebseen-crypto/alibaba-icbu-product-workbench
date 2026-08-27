function requireImages(images, count, message, minimum = false) {
  if (!Array.isArray(images) || (minimum ? images.length < count : images.length !== count)) {
    throw new Error(message);
  }
  return images.map((image) => {
    const normalized = {
      sha256: String(image?.sha256 || '').trim().toLowerCase(),
      fileName: String(image?.fileName || '').trim(),
      size: Number(image?.size),
      mimeType: String(image?.mimeType || '').trim().toLowerCase(),
    };
    if (!/^[a-f0-9]{64}$/.test(normalized.sha256) || !normalized.fileName) {
      throw new Error('图片内容指纹或文件名无效');
    }
    return normalized;
  });
}

export function assignSharedProductImages({
  variants = [],
  mainImages = [],
  marketingImages = [],
  fixedImages = [],
} = {}) {
  if (!Array.isArray(variants) || variants.length !== 4) {
    throw new Error('必须准备 4 个类似品方案');
  }
  const mains = requireImages(mainImages, 4, '必须选择 4 张主图');
  const marketing = requireImages(marketingImages, 3, '至少选择 3 张营销副图', true);
  const fixed = requireImages(fixedImages, 2, '必须配置 2 张固定副图');

  return variants.map((variant, index) => {
    const planId = String(variant?.planId || variant?.id || '').trim();
    if (!planId) throw new Error('类似品方案 ID 不能为空');
    const files = [
      mains[index],
      marketing[index % marketing.length],
      marketing[(index + 1) % marketing.length],
      marketing[(index + 2) % marketing.length],
      ...fixed,
    ].map((image) => ({ ...image }));
    if (new Set(files.map((image) => image.sha256)).size !== files.length) {
      throw new Error(`${planId} 的 6 张图片不能包含重复内容`);
    }
    return { planId, files };
  });
}
