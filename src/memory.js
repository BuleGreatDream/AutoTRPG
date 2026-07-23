import { messages, memories, sessions, groups, groupMessages } from './db.js';
import { config, features } from './config.js';
import { complete } from './llm.js';
import { parseStickerContent } from './stickers.js';

/**
 * 短期记忆：取该会话最近 N 条消息，转成 chat 格式。
 * 表情包消息只是给用户看的，不喂给模型。
 */
export function shortTerm(sessionId) {
  const recent = messages.recent(sessionId, config.memory.shortTermMessages);
  return recent
    .filter((m) => !parseStickerContent(m.content))
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * 长期记忆（摘要式）：返回该人设当前的滚动摘要文本。
 */
export function recallSummary(personaId) {
  if (!features.longTermMemory) return '';
  return memories.getSummary(personaId);
}

/** 把摘要拼成一条 system 补充消息。 */
export function memoryContextMessage(summary) {
  if (!summary) return null;
  return {
    role: 'system',
    content: `以下是你与用户过往交流的长期记忆摘要（保持人设口吻自然运用，不要机械复述）：\n${summary}`,
  };
}

/**
 * 把整段会话归纳进人设的长期记忆滚动摘要。
 *
 * 在用户删除会话并选择「保留为长期记忆」时调用：
 * - 取该会话全部 user/assistant 消息（排除表情包标记）。
 * - 用对话模型把 [旧摘要 + 本次会话全文] 整合成更新后的摘要，覆盖写回人设。
 *
 * 同步等待完成（调用方需在删除消息前 await），失败则抛出由调用方处理。
 * @returns {Promise<boolean>} 是否实际产出并写入了摘要
 */
export async function summarizeSession(sessionId) {
  if (!features.longTermMemory) return false;

  const session = sessions.get(sessionId);
  if (!session) return false;

  // 取该会话全部消息，过滤掉表情包标记与非对话角色
  const all = messages.listBySession(sessionId);
  const toSummarize = all.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !parseStickerContent(m.content)
  );
  if (!toSummarize.length) return false;

  const transcript = toSummarize
    .map((m) => `${m.role === 'user' ? '用户' : '我'}：${m.content}`)
    .join('\n');

  const personaId = session.persona_id;
  const oldSummary = memories.getSummary(personaId);

  const newSummary = await complete([
    {
      role: 'system',
      content:
        '你是对话记忆归纳器。请把【已有摘要】与【本次会话全文】整合成一份更新后的长期记忆摘要，' +
        '第一人称视角（"我"指角色，"用户"指对方）。要点：保留用户的关键信息（称呼、偏好、承诺、重要事实）与关系进展，' +
        '合并重复内容，丢弃寒暄闲聊。控制在 400 字以内，用简洁的要点式中文，只输出摘要本身。',
    },
    {
      role: 'user',
      content: `【已有摘要】\n${oldSummary || '（暂无）'}\n\n【本次会话全文】\n${transcript}`,
    },
  ]);

  if (newSummary) {
    memories.setSummary(personaId, newSummary);
    return true;
  }
  return false;
}

/**
 * 把整段群聊归纳进**每个成员各自**的长期记忆。
 *
 * 在用户删除群聊并选择「保留为长期记忆」时调用：
 * - 取群聊全部对话（排除表情包标记）。
 * - 对每个成员分别归纳：以该成员为"我"，用户与其他成员按名字称呼，写入该成员的滚动摘要。
 *
 * 同步等待完成（调用方需在删除前 await）。单个成员归纳失败不影响其他成员。
 * @param {number} groupId
 * @returns {Promise<number>} 实际写入摘要的成员数
 */
export async function summarizeGroup(groupId) {
  if (!features.longTermMemory) return 0;

  const group = groups.get(groupId);
  if (!group) return 0;

  const members = groups.members(groupId);
  if (!members.length) return 0;

  // 群聊全部对话（含说话人名字），排除表情包与非对话角色
  const all = groupMessages.listByGroup(groupId);
  const dialogue = all.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !parseStickerContent(m.content)
  );
  if (!dialogue.length) return 0;

  const groupName = group.name || '群聊';
  const topic = group.topic ? `（主题：${group.topic}）` : '';
  let written = 0;

  // 逐个成员各归纳一次：把"该成员自己的发言"标成"我"，其余按名字
  for (const me of members) {
    const transcript = dialogue
      .map((m) => {
        if (m.role === 'user') return `用户：${m.content}`;
        const speaker = m.speaker_persona_id === me.id ? '我' : (m.speaker_name || '某成员');
        return `${speaker}：${m.content}`;
      })
      .join('\n');

    const oldSummary = memories.getSummary(me.id);

    try {
      const newSummary = await complete([
        {
          role: 'system',
          content:
            `你是对话记忆归纳器。这是一段多人群聊「${groupName}」${topic}的记录，你要为其中的角色「${me.name}」整理长期记忆。` +
            '请把【已有摘要】与【本次群聊全文】整合成一份更新后的长期记忆摘要，' +
            '第一人称视角（"我"指“' + me.name + '”，"用户"指真人用户，其他名字是同群的其他角色）。' +
            '要点：保留与"我"相关的关键信息（别人对我的称呼、我的承诺、群里发生的重要事、我与用户及其他成员的关系进展），' +
            '合并重复内容，丢弃无关寒暄。控制在 400 字以内，用简洁的要点式中文，只输出摘要本身。',
        },
        {
          role: 'user',
          content: `【已有摘要】\n${oldSummary || '（暂无）'}\n\n【本次群聊全文】\n${transcript}`,
        },
      ]);

      if (newSummary) {
        memories.setSummary(me.id, newSummary);
        written++;
      }
    } catch (err) {
      console.warn(`[memory] 群聊记忆归纳失败（成员 ${me.name}）：`, err.message);
    }
  }

  return written;
}
