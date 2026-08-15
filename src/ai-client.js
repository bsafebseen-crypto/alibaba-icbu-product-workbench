import { validateGeneratedProducts } from './core.js';
import { validateSimilarProductGeneration } from './similar-product-content.js';

function requireConfig(config) {
  const baseUrl = String(config?.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(config?.apiKey ?? '').trim();
  const model = String(config?.model ?? '').trim();

  if (!baseUrl) throw new Error('请填写 Base URL');
  if (!apiKey) throw new Error('请填写 API Key');
  if (!model) throw new Error('请填写模型名称');
  return { baseUrl, apiKey, model };
}

async function requestCompletion(config, body, fetchImpl) {
  const { baseUrl, apiKey, model } = requireConfig(config);
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...body }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || `模型接口请求失败（HTTP ${response.status}）`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型没有返回可用内容');
  }
  return content.trim();
}

export async function testAiConnection(config, fetchImpl = fetch) {
  try {
    await requestCompletion(
      config,
      {
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
      },
      fetchImpl,
    );
    return { ok: true, message: '连接成功' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function parseJsonContent(content) {
  const unwrapped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unwrapped);
  } catch {
    throw new Error('模型返回的内容不是有效 JSON');
  }
}

export async function generateProducts(config, source, fetchImpl = fetch) {
  const safeSource = {
    imageNames: Array.isArray(source?.imageNames) ? source.imageNames : [],
    words: Array.isArray(source?.words) ? source.words : [],
    manualFacts: String(source?.manualFacts ?? '').trim(),
  };
  const content = await requestCompletion(
    config,
    {
      response_format: { type: 'json_object' },
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: [
            'You write Alibaba.com B2B product copy in English.',
            'Return JSON only with the shape {"products":[{"title":"","sellingPoints":[""],"keywords":[""]}]}.',
            'Return exactly five products: one base listing and four similar listings.',
            'Vary wording and keyword emphasis while describing the same real product.',
            'Do not fabricate materials, certifications, sizes, prices, performance claims, or other facts.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Create five product-copy variants from this source:\n${JSON.stringify(safeSource)}`,
        },
      ],
    },
    fetchImpl,
  );

  return validateGeneratedProducts(parseJsonContent(content));
}

function safeFaqItems(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    question: String(item?.question ?? '').trim(),
    answer: String(item?.answer ?? '').trim(),
  }));
}

function safeAttributes(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    name: String(item?.name ?? '').trim(),
    value: String(item?.value ?? '').trim(),
  }));
}

export async function generateSimilarProducts(config, source, fetchImpl = fetch) {
  const useImages = source?.useImages !== false;
  const words = Array.isArray(source?.words)
    ? source.words.map((word) => String(word ?? '').trim()).filter(Boolean)
    : [];
  const imageAssignments = Array.isArray(source?.imageAssignments)
    ? structuredClone(source.imageAssignments)
    : [];
  const originalContent = {
    title: String(source?.originalContent?.title ?? '').trim(),
    sellingPoints: String(source?.originalContent?.sellingPoints ?? '').trim(),
    faqItems: safeFaqItems(source?.originalContent?.faqItems),
    customAttributes: safeAttributes(source?.originalContent?.customAttributes),
  };
  const safeSource = {
    words,
    manualFacts: String(source?.manualFacts ?? '').trim(),
    originalContent,
    imageAssignments,
    imageNames: (Array.isArray(source?.imageDataUrls) ? source.imageDataUrls : [])
      .map((image) => String(image?.name ?? '').trim())
      .filter(Boolean),
  };
  const userContent = [{
    type: 'text',
    text: [
      'Generate four similar-product variants from this trusted source.',
      'Use only keywords present in words.',
      'For each product return title, sellingPoints, exactly five faqItems, at most five attributeChanges, and keywords.',
      `Source: ${JSON.stringify(safeSource)}`,
    ].join('\n'),
  }];

  if (useImages) {
    for (const image of Array.isArray(source?.imageDataUrls) ? source.imageDataUrls : []) {
      const dataUrl = String(image?.dataUrl ?? '');
      if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl)) {
        throw new Error(`图片数据无效：${String(image?.name || '未命名图片')}`);
      }
      userContent.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } });
    }
  }

  const content = await requestCompletion(
    config,
    {
      response_format: { type: 'json_object' },
      temperature: 0.55,
      messages: [
        {
          role: 'system',
          content: [
            'You write accurate Alibaba.com B2B product copy in English.',
            'Return JSON only with the shape {"products":[{"title":"","sellingPoints":"","faqItems":[{"question":"","answer":""}],"attributeChanges":[{"operation":"add|update|delete","name":"","after":""}],"keywords":[""]}]}.',
            'Return exactly four products and exactly five FAQ pairs per product.',
            'Each product may change at most five custom attributes.',
            'Do not fabricate materials, certifications, sizes, prices, performance claims, or other facts.',
            'Do not return image data, credentials, or XML.',
          ].join(' '),
        },
        { role: 'user', content: userContent },
      ],
    },
    fetchImpl,
  );

  const products = validateSimilarProductGeneration(parseJsonContent(content), {
    allowedKeywords: words,
    sourceAttributes: originalContent.customAttributes,
    imageAssignments,
  });
  return { products, visionUsed: useImages };
}
