import test from 'node:test';
import assert from 'node:assert/strict';

import { redactConversation, reviewConversation } from '../src/inquiry-review.js';

const messages = [{
  messageId: 'msg-secret-1', conversationId: 'conv-secret-1', sendTime: 1700000000000,
  senderAccountId: 'buyer-secret', receiverAccountId: 'seller-secret', direction: 'buyer',
  content: 'Email me at buyer@example.com or +86 138 0013 8000 for 500 jackets. Bearer abcdefghijklmnop.',
  messageType: 'TEXT',
}];

function responseFor(result, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) {
  return async () => ({ ok: true, async json() {
    return { choices: [{ message: { content: JSON.stringify(result) } }], usage };
  } });
}

function validResult() {
  return {
    customerNeeds: ['500 jackets'],
    buyingStage: { value: '询价', evidence: ['M1'] },
    strengths: [],
    missedQuestions: ['信息不足'],
    communicationIssues: [],
    risks: [],
    nextActions: ['Confirm delivery requirements'],
    replyDraft: 'Thank you for your inquiry. Could you confirm the delivery requirements?',
    evidence: [{ messageNumber: 'M1', time: '2023-11-14T22:13:20.000Z', claim: 'Buyer asked about 500 jackets.' }],
  };
}

test('redaction removes contacts, credentials, and exact platform identifiers while retaining business facts', () => {
  const result = redactConversation(messages);

  assert.doesNotMatch(result.preview, /buyer@example|138 0013|msg-secret|conv-secret|buyer-secret|seller-secret|abcdefghijklmnop/);
  assert.match(result.preview, /500 jackets/);
  assert.match(result.preview, /M1/);
  assert.equal(result.messages[0].speaker, 'Buyer');
});

test('reviewConversation never sends the source identifiers or contact details to the model', async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return responseFor(validResult())();
  };

  const record = await reviewConversation({
    baseUrl: 'https://api.deepseek.example', apiKey: 'deepseek-secret', model: 'deepseek-model',
  }, { conversationId: 'conv-secret-1', messages }, fetchImpl);

  assert.equal(record.conversationId, 'conv-secret-1');
  assert.equal(record.model, 'deepseek-model');
  assert.deepEqual(record.usage, { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  assert.equal(record.result.replyDraft, validResult().replyDraft);
  assert.doesNotMatch(JSON.stringify(requestBody), /buyer@example|138 0013|msg-secret|conv-secret|buyer-secret|seller-secret|deepseek-secret|abcdefghijklmnop/);
});

test('reviewConversation removes the configured API key if it appears verbatim in a message', async () => {
  let requestBody;
  const configuredKey = 'direct-config-secret';
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return responseFor(validResult())();
  };

  await reviewConversation({
    baseUrl: 'https://api.deepseek.example', apiKey: configuredKey, model: 'deepseek-model',
  }, {
    conversationId: 'conv-secret-1',
    messages: [{ ...messages[0], content: `Buyer copied ${configuredKey} into the chat.` }],
  }, fetchImpl);

  assert.doesNotMatch(JSON.stringify(requestBody), new RegExp(configuredKey));
});

test('reviewConversation rejects evidence that references a missing message', async () => {
  const result = validResult();
  result.buyingStage.evidence = ['M9'];
  result.evidence = [{ messageNumber: 'M9', time: '2023-11-14T22:13:20.000Z', claim: 'unsupported' }];

  await assert.rejects(
    () => reviewConversation({
      baseUrl: 'https://api.deepseek.example', apiKey: 'deepseek-secret', model: 'deepseek-model',
    }, { conversationId: 'conv-secret-1', messages }, responseFor(result)),
    /不存在的消息依据/,
  );
});

test('reviewConversation rejects malformed results and oversized display-only reply drafts', async () => {
  const missingField = validResult();
  delete missingField.risks;
  await assert.rejects(
    () => reviewConversation({ baseUrl: 'https://api.deepseek.example', apiKey: 'key', model: 'model' },
      { conversationId: 'conv-secret-1', messages }, responseFor(missingField)),
    /复盘结果格式无效/,
  );

  const oversizedDraft = validResult();
  oversizedDraft.replyDraft = 'a'.repeat(4001);
  await assert.rejects(
    () => reviewConversation({ baseUrl: 'https://api.deepseek.example', apiKey: 'key', model: 'model' },
      { conversationId: 'conv-secret-1', messages }, responseFor(oversizedDraft)),
    /复盘结果格式无效/,
  );
});
