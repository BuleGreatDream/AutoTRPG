import { groups, groupMessages } from './db.js';
import { getPersona, buildSystemPrompt } from './persona.js';
import { complete } from './llm.js';
import { streamReply } from './reply.js';
import { stickerContent, parseStickerContent } from './stickers.js';
import { fileContent } from './files.js';

// 拼给模型看的群聊上下文里，保留的最近消息条数
const GROUP_HISTORY_LIMIT = 30;

/**
 * 把一条群聊消息转成「谁说了什么」的文本行，供导演与成员理解上下文。
 * 表情包消息渲染成动作描述，避免把内部标记喂给模型。
 */
function lineOf(m) {
  const who = m.role === 'user' ? '用户' : (m.speaker_name || '某成员');
  const sticker = parseStickerContent(m.content);
  const text = sticker ? `[发送了一个表情：${sticker.emotion || sticker.id}]` : m.content;
  return `${who}：${text}`;
}

/** 取群聊最近历史，拼成纯文本对话记录。 */
function transcriptOf(groupId) {
  return groupMessages
    .recentByGroup(groupId, GROUP_HISTORY_LIMIT)
    .map(lineOf)
    .join('\n');
}

/** 群成员名册文本：名字 + 简要人设，供导演选择。 */
function rosterText(members) {
  return members
    .map((m) => {
      const card = getPersona(m.id)?.card || {};
      const brief = card.persona || card.background || '（无额外设定）';
      return `- id=${m.id} ${m.name}：${brief}`;
    })
    .join('\n');
}

/**
 * 从模型自由文本里稳健地抽出 JSON 对象。
 * 兼容 ```json 代码块、前后夹带说明文字的情况。
 */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 导演决策：给定名册与对话记录，返回一个**有序**的应答成员 id 列表。
 * @param {object} opts
 * @param {'open'|'follow'} opts.stage open=用户刚发言的首轮决策；follow=某成员发言后是否追加
 * @returns {Promise<number[]>} 有序的 personaId 列表（可能为空表示无人再回应）
 */
async function directorDecide({ members, topic, transcript, stage, remaining, lastSpeakerName }) {
  const validIds = members.map((m) => m.id);
  const roster = rosterText(members);
  const topicLine = topic ? `群聊主题/场景：${topic}\n` : '';

  const task =
    stage === 'open'
      ? `用户刚发了新消息。请判断群里哪些成员现在最自然会开口回应，并给出发言顺序。\n` +
        `重要：真实群聊里通常只有一两个人接话，不是每次都全员发言。\n` +
        `- 如果用户点名或明显只针对某一个人（如"小静，你…"），就只安排那一个人。\n` +
        `- 如果是抛给全体的开放话题，安排 1-2 个最相关的人即可，不要凑齐所有人。`
      : `刚才「${lastSpeakerName}」说完话。请判断是否还有**其他**成员此刻会自然地接话或回应（被点名、被反驳、忍不住想插话）。\n` +
        `多数情况下对话到此就够了——请倾向于返回空列表让它自然停下，只有当某成员确实很可能接话时才安排，绝不要为了热闹硬凑。`;

  const sys =
    `你是群聊的"导演"，负责调度多个 AI 角色的发言，让群聊自然真实、不冷场也不无限循环。\n` +
    topicLine +
    `群成员名册：\n${roster}\n\n` +
    `${task}\n` +
    `本轮最多还能安排 ${remaining} 次发言。只能从名册的 id 中选择。\n` +
    `严格只输出 JSON，格式：{"responders":[id, ...]}，按发言先后顺序排列，不要输出任何其他文字。`;

  let text = '';
  try {
    text = await complete([
      { role: 'system', content: sys },
      { role: 'user', content: `【当前对话记录】\n${transcript || '（空）'}` },
    ]);
  } catch {
    return [];
  }

  const parsed = extractJson(text);
  let ids = Array.isArray(parsed?.responders) ? parsed.responders : [];
  // 规整：转数字、去非法 id、去重、按剩余额度截断
  ids = [...new Set(ids.map((x) => Number(x)).filter((x) => validIds.includes(x)))];
  return ids.slice(0, remaining);
}

/**
 * 构造某个成员在群聊中作答时的上下文消息。
 */
function memberContext(persona, members, transcript, topic) {
  const others = members.filter((m) => m.id !== persona.id).map((m) => m.name);
  const topicNote = topic
    ? `这个群聊的主题/场景是：${topic}。请围绕这个场景自然融入对话。`
    : '';
  const groupNote =
    `你正在一个多人群聊里，群里还有：${others.join('、') || '（暂无其他人）'}。` +
    topicNote +
    `请**只以你自己的身份**说话，用第一人称自然回应，绝不要替别人发言或旁白他人。` +
    `可以回应用户，也可以接其他成员的话。像真人群聊那样一句句简短表达。` +
    `如果发现当前话题已经聊得差不多、或群里冷场没人接话，你可以主动挑起一个贴合你人设的新话题（抛个问题、分享点近况或趣事），` +
    `让群聊热络起来——但要自然，一次只抛一个，别硬凑。` +
    `下面是最近的群聊记录（“用户：”是真人，其他是各成员，你的历史发言以你的名字标注）。`;

  return [
    { role: 'system', content: buildSystemPrompt(persona.card) },
    { role: 'system', content: groupNote },
    { role: 'user', content: `【群聊记录】\n${transcript || '（空）'}\n\n请以${persona.card.name || '你'}的身份，接着这段群聊自然地说话。` },
  ];
}

/**
 * 处理一次群聊用户发言的完整编排（动态多轮 + 响应上限防循环）。
 *
 * @param {number} groupId
 * @param {string} userText
 * @param {object} handlers { onSpeakerStart(speaker), onSegment(text, speaker), onSticker(sticker, speaker), onToolCall }
 */
export async function handleGroupMessage(groupId, userText, handlers = {}) {
  const { onSpeakerStart, onSegment, onSticker, onToolCall, onFile } = handlers;

  const group = groups.get(groupId);
  if (!group) throw new Error('群组不存在');

  const members = groups.members(groupId);
  if (members.length < 2) throw new Error('群成员不足');

  // 1. 落库用户消息
  groupMessages.add({ groupId, role: 'user', content: userText, speakerPersonaId: null });

  const maxResponses = group.max_responses || 3;
  const topic = group.topic || '';
  let responseCount = 0;

  // 2. 首轮导演决策
  let queue = await directorDecide({
    members,
    topic,
    transcript: transcriptOf(groupId),
    stage: 'open',
    remaining: maxResponses,
  });

  // 兜底：导演没给出任何人，默认让第一个成员回应一次（避免用户发言石沉大海）
  if (!queue.length) queue = [members[0].id];

  // 3. 动态多轮回应循环
  while (queue.length && responseCount < maxResponses) {
    const personaId = queue.shift();
    const persona = getPersona(personaId);
    if (!persona) continue;

    const speaker = { personaId, name: persona.card.name || persona.name, avatar: persona.avatar || null };
    onSpeakerStart?.(speaker);

    // 该成员基于「当前为止的群聊记录」作答（含本轮之前成员已说的话）
    const context = memberContext(persona, members, transcriptOf(groupId), topic);

    await streamReply({
      messages: context,
      personaId,
      onSentence: (text) => {
        groupMessages.add({ groupId, role: 'assistant', content: text, speakerPersonaId: personaId });
        onSegment?.(text, speaker);
      },
      onSticker: (sticker) => {
        groupMessages.add({
          groupId,
          role: 'assistant',
          content: stickerContent(sticker.id),
          speakerPersonaId: personaId,
        });
        onSticker?.(sticker, speaker);
      },
      onFile: (meta) => {
        groupMessages.add({
          groupId,
          role: 'assistant',
          content: fileContent(meta),
          speakerPersonaId: personaId,
        });
        onFile?.(meta, speaker);
      },
      onToolCall,
    });

    responseCount++;

    // 4. 达到上限则停止；否则问导演是否有其他成员追加
    if (responseCount >= maxResponses) break;

    const follow = await directorDecide({
      members,
      topic,
      transcript: transcriptOf(groupId),
      stage: 'follow',
      remaining: maxResponses - responseCount,
      lastSpeakerName: speaker.name,
    });

    // 追加进队列（去掉已在队列中的，避免同一轮重复堆积）
    for (const id of follow) {
      if (!queue.includes(id)) queue.push(id);
    }
  }
}
