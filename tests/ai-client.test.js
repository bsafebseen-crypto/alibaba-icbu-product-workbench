import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateProducts, generateSimilarProducts, requestAiCompletion, testAiConnection,
} from '../src/ai-client.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test('testAiConnection calls the OpenAI-compatible endpoint with bearer auth', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
  };

  const result = await testAiConnection(
    {
      baseUrl: 'https://models.example.com/v1/',
      apiKey: 'test-key',
      model: 'example-model',
    },
    fetchImpl,
  );

  assert.deepEqual(result, { ok: true, message: '连接成功' });
  assert.equal(request.url, 'https://models.example.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(request.options.body).model, 'example-model');
});

test('testAiConnection returns a readable provider error', async () => {
  const fetchImpl = async () => jsonResponse(
    { error: { message: 'Invalid API key' } },
    false,
    401,
  );

  const result = await testAiConnection(
    { baseUrl: 'https://models.example.com/v1', apiKey: 'bad', model: 'm' },
    fetchImpl,
  );

  assert.deepEqual(result, { ok: false, message: 'Invalid API key' });
});

test('requestAiCompletion returns normalized content and token usage', async () => {
  const completion = await requestAiCompletion(
    { baseUrl: 'https://models.example.com/v1', apiKey: 'key', model: 'model' },
    { messages: [{ role: 'user', content: 'Hello' }] },
    async () => jsonResponse({
      choices: [{ message: { content: '  OK  ' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }),
  );

  assert.deepEqual(completion, {
    content: 'OK', usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
  });
});

test('generateProducts requests JSON and returns five normalized products', async () => {
  let requestBody;
  const generated = Array.from({ length: 5 }, (_, index) => ({
    title: `Safety Vest ${index + 1}`,
    sellingPoints: [`Point ${index + 1}`],
    keywords: ['safety vest'],
  }));
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ products: generated }) } }],
    });
  };

  const products = await generateProducts(
    {
      baseUrl: 'https://models.example.com/v1',
      apiKey: 'key',
      model: 'model',
    },
    {
      imageNames: ['front.jpg', 'back.jpg'],
      words: ['safety vest', 'reflective workwear'],
      manualFacts: 'yellow, polyester',
    },
    fetchImpl,
  );

  assert.equal(products.length, 5);
  assert.equal(products[0].kind, 'base');
  assert.equal(requestBody.response_format.type, 'json_object');
  assert.match(requestBody.messages[1].content, /reflective workwear/);
  assert.doesNotMatch(requestBody.messages[0].content, /invent|编造事实/i);
});

test('generateProducts does not accept fewer than five products', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"products":[]}' } }],
  });

  await assert.rejects(
    () => generateProducts(
      { baseUrl: 'https://models.example.com/v1', apiKey: 'key', model: 'model' },
      { words: ['vest'] },
      fetchImpl,
    ),
    /必须正好生成 5 个商品版本/,
  );
});

function similarProduct(index) {
  return {
    title: `Reflective Safety Vest ${index}`,
    sellingPoints: `Selling point ${index}`,
    faqItems: Array.from({ length: 5 }, (_, faqIndex) => ({
      question: `Question ${faqIndex + 1}?`,
      answer: `Answer ${faqIndex + 1}.`,
    })),
    attributeChanges: [
      { operation: 'update', name: 'Closure Style', after: `Zipper ${index}` },
    ],
    keywords: ['safety vest'],
  };
}

const similarSource = {
  useImages: true,
  imageDataUrls: [
    { name: 'main-1.jpg', dataUrl: 'data:image/jpeg;base64,AAA' },
    { name: 'main-2.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
    { name: 'main-3.jpg', dataUrl: 'data:image/jpeg;base64,CCC' },
    { name: 'main-4.jpg', dataUrl: 'data:image/jpeg;base64,DDD' },
    { name: 'aux-1.jpg', dataUrl: 'data:image/jpeg;base64,EEE' },
    { name: 'aux-2.jpg', dataUrl: 'data:image/jpeg;base64,FFF' },
    { name: 'aux-3.jpg', dataUrl: 'data:image/jpeg;base64,GGG' },
    { name: 'aux-4.jpg', dataUrl: 'data:image/jpeg;base64,HHH' },
    { name: 'aux-5.jpg', dataUrl: 'data:image/jpeg;base64,III' },
  ],
  imageAssignments: Array.from({ length: 4 }, (_, index) => ({
    mainImageIndex: index,
    auxiliaryImageIndexes: [0, 1, 2, 3, 4],
  })),
  words: ['safety vest', 'reflective workwear'],
  manualFacts: 'Polyester safety vest.',
  originalContent: {
    title: 'Original Vest',
    sellingPoints: 'Original summary',
    faqItems: Array.from({ length: 5 }, () => ({ question: 'Original?', answer: 'Yes.' })),
    customAttributes: [
      { name: 'Material', value: 'Polyester' },
      { name: 'Closure Style', value: 'Front Zipper' },
    ],
  },
  schemaXml: '<itemSchema>must-not-leak</itemSchema>',
  appSecret: 'must-not-leak',
  accessToken: 'must-not-leak',
};

test('generateSimilarProducts sends an allow-listed multimodal request and returns four products', async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({
        products: Array.from({ length: 4 }, (_, index) => similarProduct(index + 1)),
      }) } }],
    });
  };

  const result = await generateSimilarProducts(
    { baseUrl: 'https://models.example.com/v1', apiKey: 'key', model: 'vision-model' },
    similarSource,
    fetchImpl,
  );

  assert.equal(result.products.length, 4);
  assert.equal(result.visionUsed, true);
  const userContent = requestBody.messages[1].content;
  assert.equal(userContent.filter((item) => item.type === 'image_url').length, 9);
  assert.equal(userContent[1].image_url.url, 'data:image/jpeg;base64,AAA');
  assert.match(userContent[0].text, /reflective workwear/);
  assert.doesNotMatch(JSON.stringify(requestBody), /must-not-leak|itemSchema/);
});

test('generateSimilarProducts uses explicit text-only mode without silently claiming vision', async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({
        products: Array.from({ length: 4 }, (_, index) => similarProduct(index + 1)),
      }) } }],
    });
  };

  const result = await generateSimilarProducts(
    { baseUrl: 'https://models.example.com/v1', apiKey: 'key', model: 'text-model' },
    { ...similarSource, useImages: false },
    fetchImpl,
  );

  assert.equal(result.visionUsed, false);
  assert.equal(requestBody.messages[1].content.some((item) => item.type === 'image_url'), false);
});

test('generateSimilarProducts surfaces an image-capability error without retrying', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ error: { message: 'This model does not support image input' } }, false, 400);
  };

  await assert.rejects(
    () => generateSimilarProducts(
      { baseUrl: 'https://models.example.com/v1', apiKey: 'key', model: 'text-model' },
      similarSource,
      fetchImpl,
    ),
    /does not support image input/,
  );
  assert.equal(calls, 1);
});
