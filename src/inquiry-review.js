import { requestAiCompletion } from './ai-client.js';

const REDACTION_VERSION = 1;
const MAX_ARRAY_ITEMS = 20;
const MAX_REPLY_DRAFT_LENGTH = 4000;
const RESULT_FIELDS = [
  'customerNeeds', 'buyingStage', 'strengths', 'missedQuestions',
  'communicationIssues', 'risks', 'nextActions', 'replyDraft', 'evidence',
];
const LIST_FIELDS = [
  'customerNeeds', 'strengths', 'missedQuestions', 'communicationIssues', 'risks', 'nextActions',
];

function exactReplace(value, replacements) {
  let result = String(value ?? '');
  for (const replacement of replacements) result = result.split(replacement).join('[ID]');
  return result;
}

function redactContent(value, identifiers) {
  return exactReplace(value, identifiers)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[CREDENTIAL]')
    .replace(/(?:api[_ -]?key|access[_ -]?token|secret|token)\s*[:=]\s*[A-Za-z0-9._-]{8,}/gi, '[CREDENTIAL]');
}

function knownIdentifiers(messages, additionalIdentifiers = []) {
  const identifiers = new Set();
  for (const message of messages) {
    for (const key of ['messageId', 'conversationId', 'senderAccountId', 'receiverAccountId']) {
      const value = String(message?.[key] ?? '').trim();
      if (value) identifiers.add(value);
    }
  }
  for (const value of additionalIdentifiers) {
    const normalized = String(value ?? '').trim();
    if (normalized) identifiers.add(normalized);
  }
  return [...identifiers].sort((left, right) => right.length - left.length);
}

export function redactConversation(messages, additionalIdentifiers = []) {
  if (!Array.isArray(messages)) throw new Error('会话消息格式无效');
  const identifiers = knownIdentifiers(messages, additionalIdentifiers);
  const safe = messages.map((message, index) => ({
    messageNumber: `M${index + 1}`,
    time: new Date(message?.sendTime).toISOString(),
    speaker: message?.direction === 'seller' ? 'Salesperson' : 'Buyer',
    content: redactContent(message?.content, identifiers),
  }));
  return {
    messages: safe,
    preview: safe.map((item) => `${item.messageNumber} ${item.time} ${item.speaker}: ${item.content}`).join('\n'),
    redactionVersion: REDACTION_VERSION,
  };
}

function parseJsonContent(content) {
  const unwrapped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unwrapped);
  } catch {
    throw new Error('模型返回的内容不是有效 JSON');
  }
}

function hasExactKeys(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function validString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function validStringList(value) {
  return Array.isArray(value) && value.length <= MAX_ARRAY_ITEMS && value.every(validString);
}

function evidenceError() {
  return new Error('复盘结果包含不存在的消息依据');
}

function validateEvidenceReferences(value, messageNumbers) {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) throw new Error('复盘结果格式无效');
  for (const item of value) {
    if (!hasExactKeys(item, ['messageNumber', 'time', 'claim'])
      || !validString(item.messageNumber)
      || !(validString(item.time) || Number.isFinite(item.time))
      || !validString(item.claim)) {
      throw new Error('复盘结果格式无效');
    }
    if (!messageNumbers.has(item.messageNumber)) throw evidenceError();
  }
}

function validateReviewResult(value, messageNumbers) {
  if (!hasExactKeys(value, RESULT_FIELDS)
    || !LIST_FIELDS.every((field) => validStringList(value[field]))
    || !hasExactKeys(value.buyingStage, ['value', 'evidence'])
    || !validString(value.buyingStage.value)
    || !validStringList(value.buyingStage.evidence)
    || !validString(value.replyDraft)
    || value.replyDraft.length > MAX_REPLY_DRAFT_LENGTH) {
    throw new Error('复盘结果格式无效');
  }
  for (const reference of value.buyingStage.evidence) {
    if (!messageNumbers.has(reference)) throw evidenceError();
  }
  validateEvidenceReferences(value.evidence, messageNumbers);
  return value;
}

function reviewPrompt(redacted) {
  return [
    {
      role: 'system',
      content: [
        'You review one Alibaba.com buyer conversation for a salesperson.',
        'Return JSON only. Do not include any customer contact details or identifiers.',
        'Use only the anonymized messages. Mark any unsupported conclusion as 信息不足.',
        'Return exactly customerNeeds, buyingStage, strengths, missedQuestions, communicationIssues, risks, nextActions, replyDraft, and evidence.',
        'buyingStage is {"value":"","evidence":["M1"]}.',
        'Each evidence entry is {"messageNumber":"M1","time":"","claim":""}.',
        'Every evidence message number must come from the supplied messages. replyDraft is a display-only English draft and must not be sent.',
      ].join(' '),
    },
    { role: 'user', content: JSON.stringify({ messages: redacted.messages }) },
  ];
}

export async function reviewConversation(config, conversation, fetchImpl = fetch) {
  const conversationId = String(conversation?.conversationId ?? '').trim();
  if (!conversationId) throw new Error('会话编号不能为空');
  const sourceMessages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const redacted = redactConversation(sourceMessages.map((message) => ({
    ...message,
    conversationId: message?.conversationId ?? conversationId,
  })), [config?.apiKey]);
  const { content, usage } = await requestAiCompletion(config, {
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: reviewPrompt(redacted),
  }, fetchImpl);
  const result = validateReviewResult(
    parseJsonContent(content),
    new Set(redacted.messages.map((message) => message.messageNumber)),
  );
  return {
    conversationId,
    model: String(config?.model ?? '').trim(),
    createdAt: new Date().toISOString(),
    usage,
    redactionVersion: redacted.redactionVersion,
    result,
  };
}
