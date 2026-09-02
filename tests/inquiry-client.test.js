import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeInquiryCapability,
  queryConversations,
  queryMessages,
} from '../src/inquiry-client.js';
import { signAlibabaParams } from '../src/alibaba-client.js';

const config = {
  inquiryGatewayUrl: 'https://eco.example.com/router/rest',
  appKey: 'fictional-key',
  appSecret: 'fictional-secret',
};

test('queryConversations calls only the conversation read method without session', async () => {
  let request;
  const result = await queryConversations(config, {
    sellerAccountId: 'seller-01', count: 1, limitTimestamp: '1700000000000',
  }, async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, async json() {
      return { alibaba_interaction_im_conversation_list_query_response: {
        request_id: 'req-1', result: {
          conversation_list: [{ conversation_id: 'conv-1', latest_message_time: 1700000001000 }],
          has_more: true, next_time_stamp: 1700000001000,
        },
      } };
    } };
  }, 1700000002000);
  assert.equal(request.body.method, 'alibaba.interaction.im.conversation.list.query');
  assert.equal('session' in request.body, false);
  assert.equal(request.body.seller_account_id, 'seller-01');
  assert.equal(request.body.sign, signAlibabaParams(
    Object.fromEntries(Object.entries(request.body).filter(([key]) => key !== 'sign')),
    config.appSecret,
  ));
  assert.equal(result.items[0].conversationId, 'conv-1');
  assert.equal(result.hasMore, true);
  assert.equal(result.requestId, 'req-1');
});

test('queryMessages fixes direction relative to selfAccountId', async () => {
  const result = await queryMessages(config, {
    conversationId: 'conv-1', selfAccountId: 'seller-01', count: 50,
  }, async () => ({ ok: true, async json() {
    return { alibaba_interaction_im_message_list_query_response: { result: {
      message_list: [{ message_id: 'm-1', conversation_id: 'conv-1', send_time: 10,
        sender_account_id: 'buyer-01', receiver_account_id: 'seller-01',
        content: 'Need 500 pieces', message_type: 'TEXT' }], has_more: false,
    } } };
  } }), 20);
  assert.equal(result.items[0].direction, 'buyer');
  assert.equal(result.items[0].content, 'Need 500 pieces');
});

test('probeInquiryCapability classifies permission errors without leaking secrets', async () => {
  await assert.rejects(() => probeInquiryCapability(config, 'seller-01', async () => ({
    ok: true,
    async json() { return { error_response: { code: 27, sub_code: 'isp.permission-denied', msg: 'No permission' } }; },
  }), 20), (error) => error.code === 'permission_denied' && !error.message.includes('fictional-secret'));
});

test('validates IDs, counts, timestamps and forward', async () => {
  const noCall = async () => { throw new Error('fetch should not run'); };
  await assert.rejects(() => queryConversations(config, { sellerAccountId: '', count: 1 }, noCall), /不能为空/);
  await assert.rejects(() => queryConversations(config, { sellerAccountId: 'seller', count: 51 }, noCall), /count/);
  await assert.rejects(() => queryConversations(config, { sellerAccountId: 'seller', limitTimestamp: 'x' }, noCall), /时间戳/);
  await assert.rejects(() => queryConversations(config, { sellerAccountId: 'seller', forward: 'yes' }, noCall), /forward/);
});

test('maps malformed responses to a stable error code', async () => {
  await assert.rejects(() => queryMessages(config, { conversationId: 'c', selfAccountId: 's' }, async () => ({
    ok: true, async json() { return {}; },
  })), (error) => error.code === 'malformed_response');
});

test('maps null and undefined JSON bodies to malformed_response', async () => {
  for (const value of [null, undefined]) {
    await assert.rejects(() => queryMessages(config, { conversationId: 'c', selfAccountId: 's' }, async () => ({
      ok: true, async json() { return value; },
    })), (error) => error.code === 'malformed_response');
  }
});

test('rejects numeric pagination timestamps', async () => {
  await assert.rejects(() => queryConversations(config, { sellerAccountId: 'seller', limitTimestamp: 123 }, async () => {
    throw new Error('fetch should not run');
  }), /时间戳/);
});

test('rejects a response wrapper belonging to another API', async () => {
  await assert.rejects(() => queryMessages(config, { conversationId: 'c', selfAccountId: 's' }, async () => ({
    ok: true, async json() { return {
      other_api_response: { result: { message_list: [] } },
    }; },
  })), (error) => error.code === 'malformed_response');
});
