import { sessions, messages } from './db.js';
import { getPersona, buildSystemPrompt } from './persona.js';
import { shortTerm, recallSummary, memoryContextMessage } from './memory.js';
import { stickerContent } from './stickers.js';
import { fileContent } from './files.js';
import { streamReply } from './reply.js';

/**
 * 处理一次用户发言的完整编排。
 * 通过 handlers 把过程事件推给调用方（server 层转成 SSE）。
 *
 * @param {number} sessionId
 * @param {string} userText
 * @param {object} handlers { onSegment, onToolCall, onSticker }
 * @returns {Promise<string>} 最终 assistant 文本
 */
export async function handleUserMessage(sessionId, userText, handlers = {}) {
  const { onSegment, onToolCall, onSticker, onFile } = handlers;

  const session = sessions.get(sessionId);
  if (!session) throw new Error('会话不存在');

  const persona = getPersona(session.persona_id);
  if (!persona) throw new Error('人设不存在');

  // 1. 先落库用户消息
  messages.add({ sessionId, role: 'user', content: userText });

  // 2. 组装上下文：system 人设 + 长期记忆摘要 + 短期窗口
  const systemPrompt = buildSystemPrompt(persona.card);
  const summary = recallSummary(persona.id);
  const history = shortTerm(sessionId); // 已含刚落库的 user 消息

  const contextMessages = [{ role: 'system', content: systemPrompt }];
  const memMsg = memoryContextMessage(summary);
  if (memMsg) contextMessages.push(memMsg);
  contextMessages.push(...history);

  // 3. 流式生成：逐句切分、逐句落库并推送，模拟真人一句句发消息
  await streamReply({
    messages: contextMessages,
    personaId: persona.id,
    onSentence: (text) => {
      messages.add({ sessionId, role: 'assistant', content: text });
      onSegment?.(text);
    },
    onSticker: (sticker) => {
      messages.add({ sessionId, role: 'assistant', content: stickerContent(sticker.id) });
      onSticker?.(sticker);
    },
    onFile: (meta) => {
      messages.add({ sessionId, role: 'assistant', content: fileContent(meta) });
      onFile?.(meta);
    },
    onToolCall,
  });

  // 注：长期记忆不在对话过程中汇总，改为用户删除会话并选择「保留」时才归纳（见 memory.summarizeSession）。
}
