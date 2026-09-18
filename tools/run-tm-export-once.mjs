import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { callAlibabaApi } from '../src/alibaba-client.js';
import { queryConversations, queryMessages } from '../src/inquiry-client.js';
import { calculateConversationMetrics } from '../src/inquiry-metrics.js';

const port = 54026;
const outputDirectory = 'C:/Users/zhanghuaiming/Desktop/阿里自动发品/TM询盘报告';
const thirtyDaysAgo = () => Date.now() - (30 * 24 * 60 * 60 * 1000);

function findAccountId(value) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, candidate] of Object.entries(value)) {
    if (['account_id', 'accountId', 'member_id', 'memberId'].includes(key)
      && String(candidate || '').trim()) return String(candidate).trim();
  }
  for (const candidate of Object.values(value)) {
    const result = findAccountId(candidate);
    if (result) return result;
  }
  return '';
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (body.length > 200_000) throw new Error('请求内容过大');
  return JSON.parse(body || '{}');
}

async function writeReport(result) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(outputDirectory, `TM询盘只读报告-${stamp}.md`);
  const lines = [
    '# TM/询盘只读报告',
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '- 统计范围：最近 30 天',
    '- 数据操作：只读；未发送消息，未修改客户数据',
    '- 原始聊天内容：未落盘',
    '',
    '## 运行结果',
    '',
    `- 状态：${result.status}`,
    `- TM 会话数：${result.conversations ?? 0}`,
    `- 消息数：${result.messages ?? 0}`,
    `- 买家消息数：${result.buyerMessages ?? 0}`,
    `- 业务员消息数：${result.sellerMessages ?? 0}`,
    `- 未回复会话数：${result.unanswered ?? 0}`,
    `- 已回复会话数：${result.answered ?? 0}`,
    `- 平均首次响应：${result.avgFirstResponseMinutes == null ? '暂无' : `${result.avgFirstResponseMinutes} 分钟`}`,
    `- 接口分页是否截断：${result.truncated ? '是' : '否'}`,
    '',
    '## 说明',
    '',
    result.note || 'TM 会话和消息读取成功。',
  ];
  if (result.error) lines.push(
    '',
    '## 失败原因',
    '',
    `- 错误类别：${result.error.code || 'unknown'}`,
    `- 阿里返回：${result.error.message}`,
  );
  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

async function collectReport(config) {
  const member = await callAlibabaApi(config, 'alibaba.member.info.get', { biz_type: 'xiaoman' });
  const accountId = findAccountId(member);
  if (!accountId) {
    throw Object.assign(new Error('会员接口成功，但未找到业务员数字账号 ID'), {
      code: 'account_id_missing',
    });
  }

  const cutoff = thirtyDaysAgo();
  let cursor = '';
  let truncated = false;
  const conversations = [];
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await queryConversations(config, {
      sellerAccountId: accountId,
      count: 50,
      ...(cursor ? { limitTimestamp: cursor } : {}),
    });
    const items = page.items || [];
    for (const item of items) {
      const timestamp = Number(item.latestMessageTime);
      if (!Number.isFinite(timestamp) || timestamp >= cutoff) conversations.push(item);
    }
    const timestamps = items.map((item) => Number(item.latestMessageTime)).filter(Number.isFinite);
    const oldest = timestamps.length ? Math.min(...timestamps) : Number.NaN;
    if (!page.hasMore || !page.nextTimestamp || (Number.isFinite(oldest) && oldest < cutoff)) break;
    if (pageNumber === 19) {
      truncated = true;
      break;
    }
    cursor = String(page.nextTimestamp);
  }

  const uniqueConversations = [...new Map(
    conversations.map((conversation) => [conversation.conversationId, conversation]),
  ).values()];
  let messageCount = 0;
  let buyerMessages = 0;
  let sellerMessages = 0;
  let unanswered = 0;
  let answered = 0;
  const firstResponses = [];

  for (const conversation of uniqueConversations) {
    let messageCursor = '';
    const messages = [];
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await queryMessages(config, {
        conversationId: conversation.conversationId,
        selfAccountId: accountId,
        count: 50,
        ...(messageCursor ? { limitTimestamp: messageCursor } : {}),
      });
      messages.push(...page.items
        .map((message) => ({ ...message, sendTime: Number(message.sendTime) }))
        .filter((message) => Number.isFinite(message.sendTime) && message.sendTime >= cutoff));
      if (!page.hasMore || !page.nextTimestamp) break;
      if (pageNumber === 99) {
        truncated = true;
        break;
      }
      messageCursor = String(page.nextTimestamp);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const metrics = calculateConversationMetrics(messages, Date.now());
    messageCount += messages.length;
    buyerMessages += metrics.buyerMessageCount;
    sellerMessages += metrics.sellerMessageCount;
    if (metrics.unanswered) unanswered += 1;
    else if (messages.length) answered += 1;
    if (metrics.firstResponseMs != null) firstResponses.push(metrics.firstResponseMs);
  }

  return {
    status: '成功',
    conversations: uniqueConversations.length,
    messages: messageCount,
    buyerMessages,
    sellerMessages,
    unanswered,
    answered,
    avgFirstResponseMinutes: firstResponses.length
      ? Math.round((firstResponses.reduce((sum, value) => sum + value, 0)
        / firstResponses.length / 60_000) * 10) / 10
      : null,
    truncated,
    note: 'TM 会话与历史消息接口读取成功。当前公开接口不提供可确认的独立询盘列表，因此报告将 TM 数据与独立询盘口径分开说明。',
  };
}

const html = `<!doctype html><meta charset="utf-8"><title>TM只读导出</title>
<style>body{font-family:system-ui;margin:40px;max-width:760px}label{display:block;margin:14px 0}input{width:100%;padding:10px}button{padding:12px 20px}pre{white-space:pre-wrap}</style>
<h1>TM/询盘只读导出</h1><p>最近30天，原始聊天仅在内存处理，报告只写汇总。</p>
<form id="form"><label>网关<input id="gateway"></label><label>App Key<input id="key"></label><label>App Secret<input id="secret" type="password"></label><label>Access Token<input id="token" type="password"></label><button>开始只读导出</button></form><pre id="output"></pre>
<script>form.onsubmit=async(event)=>{event.preventDefault();output.textContent='正在读取并统计，请勿关闭…';try{const response=await fetch('/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gatewayUrl:gateway.value,appKey:key.value,appSecret:secret.value,accessToken:token.value})});const result=await response.json();output.textContent=result.ok?'导出完成\\n'+result.reportPath+'\\n会话：'+result.conversations+'，消息：'+result.messages:'导出未完成\\n'+result.message+'\\n诊断报告：'+(result.reportPath||'');}catch(error){output.textContent=error.message}}</script>`;

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/run') {
    response.writeHead(404).end();
    return;
  }
  let reportPath = '';
  try {
    const config = await readJson(request);
    const result = await collectReport(config);
    reportPath = await writeReport(result);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, reportPath, ...result }));
  } catch (error) {
    const result = {
      status: '未完成',
      error: { code: String(error.code || 'unknown'), message: String(error.message || '未知错误') },
      note: '已完成只读探测；未进行任何写入操作。',
    };
    reportPath = await writeReport(result).catch(() => '');
    response.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({
      ok: false,
      reportPath,
      message: result.error.message,
      code: result.error.code,
    }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`READY http://127.0.0.1:${port}`);
});
