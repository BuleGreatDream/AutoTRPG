import { config, assertChatConfig, features } from './config.js';
import { webSearchTool, tavilySearch } from './search.js';
import { hasStickers, buildStickerTool, getSticker } from './stickers.js';
import { buildKnowledgeTool, searchKnowledge } from './knowledge.js';
import { buildFileTool } from './filetool.js';
import { createTempFile } from './files.js';

// tool name -> 执行函数。ctx 携带调用上下文（如 personaId，用于资料检索按人设隔离）。
const toolHandlers = {
  web_search: async (args) => tavilySearch(args.query || '', args.domains),
  // send_sticker 只是给模型一个"发送"动作的回执，真正的推送由 onSticker 回调完成
  send_sticker: async (args) => {
    const sticker = getSticker(args.id);
    return sticker ? { ok: true, sent: sticker.id } : { ok: false, error: '没有该表情包' };
  },
  search_knowledge: async (args, ctx) => {
    if (!ctx?.personaId && !ctx?.groupId) return { error: '无资料库上下文。' };
    // 检索范围 = 人设授权 ∪ 群聊授权
    return searchKnowledge({ personaId: ctx.personaId, groupId: ctx.groupId }, args.query || '');
  },
  // create_file 真正的推送由 onFile 回调完成（在 streamChat 里），这里只做回执
  create_file: async (args, ctx) => {
    if (!args.content) return { ok: false, error: '缺少文件内容' };
    return { ok: true, filename: ctx?.lastFile?.filename || args.filename };
  },
};

// 无人设/群聊上下文时不挂知识工具；有其一即按（人设 ∪ 群聊）授权挂载
function availableTools(personaId, groupId) {
  const tools = [];
  if (features.webSearch) tools.push(webSearchTool);
  if (hasStickers) tools.push(buildStickerTool());
  if (personaId || groupId) {
    const kbTool = buildKnowledgeTool({ personaId, groupId });
    if (kbTool) tools.push(kbTool);
  }
  tools.push(buildFileTool()); // create_file 始终可用
  return tools;
}

// [复用模块] 统一的 /chat/completions POST：拼 baseUrl、鉴权头、body 与错误信息。
// stream=true 时调用方从 res.body 读 SSE；否则解析 JSON。errLabel 用于区分报错来源。
async function postChatCompletions(body, errLabel = '大模型请求失败') {
  const res = await fetch(`${config.chat.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.chat.apiKey}`,
    },
    body: JSON.stringify({ model: config.chat.model, ...body }),
  });
  if (!res.ok || (body.stream && !res.body)) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${errLabel} (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res;
}

/**
 * 单次流式请求。逐块读取 OpenAI 兼容的 SSE，
 * 通过回调把文本 token 吐出，同时累积 tool_calls。
 * 返回 { content, toolCalls, finishReason }。
 */
async function streamOnce({ messages, tools, onToken }) {
  const res = await postChatCompletions({
    messages,
    tools: tools.length ? tools : undefined,
    stream: true,
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = []; // 按 index 累积
  let finishReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留最后不完整的一行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue; // 跳过无法解析的分片
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};

      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  return { content, toolCalls: toolCalls.filter(Boolean), finishReason };
}

/**
 * 完整对话：带 tool-call 循环的流式生成。
 * @param {object[]} messages 初始消息（含 system）
 * @param {(token:string)=>void} onToken 文本增量回调
 * @param {(name:string, args:object)=>void} onToolCall 工具触发回调（用于前端提示）
 * @param {number} [personaId] 当前作答人设 id，用于挂载资料检索工具
 * @param {number} [groupId] 群聊 id（群聊场景），其授权与人设授权合并检索
 * @returns {Promise<string>} 最终 assistant 文本
 */
export async function streamChat({ messages, onToken, onToolCall, onSticker, onFile, personaId, groupId }) {
  assertChatConfig();
  const tools = availableTools(personaId, groupId);
  const toolCtx = { personaId, groupId };
  const working = [...messages];
  const maxRounds = 4; // 防止无限工具循环

  for (let round = 0; round < maxRounds; round++) {
    const { content, toolCalls, finishReason } = await streamOnce({
      messages: working,
      tools,
      onToken,
    });

    if (finishReason === 'tool_calls' && toolCalls.length) {
      // 记录 assistant 的工具调用回合
      working.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

      // 逐个执行工具并回填结果
      for (const call of toolCalls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }

        // 按工具类型分发前端事件
        if (call.function.name === 'send_sticker') {
          const sticker = getSticker(args.id);
          if (sticker) onSticker?.(sticker); // 推送表情包给前端渲染
        } else if (call.function.name === 'create_file') {
          // 生成临时文件并推送给前端；把 meta 挂到 ctx 供 handler 回执
          if (args.content) {
            const meta = createTempFile({ filename: args.filename, content: args.content, format: args.format });
            toolCtx.lastFile = meta;
            onFile?.(meta);
          }
        } else {
          onToolCall?.(call.function.name, args);
        }

        const handler = toolHandlers[call.function.name];
        const result = handler
          ? await handler(args, toolCtx)
          : { error: `未知工具：${call.function.name}` };

        working.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // 带着工具结果再来一轮
    }

    // 正常结束
    return content;
  }

  // 达到工具循环上限，做最后一次无工具收尾
  const { content } = await streamOnce({ messages: working, tools: [], onToken });
  return content;
}

/**
 * 非流式补全。用于长期记忆的摘要归纳等后台任务。
 * @param {object[]} messages
 * @returns {Promise<string>}
 */
export async function complete(messages) {
  assertChatConfig();
  const res = await postChatCompletions({ messages, stream: false }, '摘要请求失败');
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}
