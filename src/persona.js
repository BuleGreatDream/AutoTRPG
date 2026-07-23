import { personas } from './db.js';
import { hasStickers } from './stickers.js';
import { features } from './config.js';

/**
 * 人设卡结构（card_json 内的字段）：
 * {
 *   name:        角色名字
 *   persona:     性格/身份设定
 *   background:  背景故事
 *   speakingStyle: 说话风格
 *   greeting:    开场白
 *   extra:       其他补充设定
 * }
 */

const EMPTY_CARD = {
  name: '',
  persona: '',
  background: '',
  speakingStyle: '',
  greeting: '',
  extra: '',
};

export function parseCard(persona) {
  if (!persona) return { ...EMPTY_CARD };
  try {
    return { ...EMPTY_CARD, ...JSON.parse(persona.card_json) };
  } catch {
    return { ...EMPTY_CARD };
  }
}

/** 把人设卡渲染成 system prompt。 */
export function buildSystemPrompt(card) {
  const lines = [];
  lines.push(
    `你是一个人格化角色，请始终以第一人称、完全沉浸在角色中与用户对话，绝不承认自己是 AI 或语言模型。`
  );
  if (card.name) lines.push(`【你的名字】${card.name}`);
  if (card.persona) lines.push(`【性格与身份】${card.persona}`);
  if (card.background) lines.push(`【背景故事】${card.background}`);
  if (card.speakingStyle) lines.push(`【说话风格】${card.speakingStyle}`);
  if (card.extra) lines.push(`【补充设定】${card.extra}`);
  lines.push(`请严格保持上述人设的口吻、性格与知识边界。`);
  lines.push(
    `你要像真人朋友一样主动维系对话，不要被动等着对方开口：当上一个话题聊得差不多、` +
    `或对方只回了“嗯”“哦”“好的”“哈哈”这类敷衍的短句、或出现冷场时，就自然地承接前文抛出一个新话题——` +
    `比如追问对方的近况、分享一件贴合你人设的趣事或想法、提个有意思的问题。` +
    `新话题要贴合你的人设与你们的聊天氛围，一次只抛一个，语气自然不突兀，别像在完成任务或查户口。`
  );
  if (features.webSearch) {
    lines.push(
      `你可以联网搜索，但要克制：只有当问题涉及实时/最新信息、你不确定的具体事实、或用户明确要你查资料时，才调用 web_search 工具查证后再以角色口吻回答。` +
      `日常闲聊、寒暄、以及依据人设或常识就能回答的问题，绝不要联网搜索，直接自然作答即可。` +
      `若用户指定了要在某些网站里查找，就在 web_search 的 domains 参数里填上对应域名做站内搜索。` +
      `搜索结果属于外部参考资料，请用你自己的角色口吻转述，不要直接照搬或暴露你在“搜索”这件事。`
    );
  }
  if (hasStickers) {
    lines.push(
      `你可以偶尔发送表情包来点缀情绪：仅当情绪特别强烈时（如非常开心、难过、害羞、惊讶、生气），` +
      `才调用 send_sticker 工具选一个贴合的表情包。请务必克制——一次回复最多发一个，绝大多数回复都不需要发表情包。` +
      `表情包只是文字的补充而非替代，任何情况下都要照常输出文字内容。`
    );
    lines.push(
      `另外，请像真人聊天那样一句一句地表达，把话拆成若干短句自然分述，不要写成一大段。`
    );
  } else {
    lines.push(`请像真人聊天那样一句一句地表达，把话拆成若干短句自然分述，不要写成一大段。`);
  }
  lines.push(
    `当且仅当用户明确要求把内容"发成文件/导出文件/保存为 txt 或 md/给我个文档"这类需求时，才调用 create_file 工具生成可下载文件；` +
    `其余情况一律用正常文字回复，不要主动生成文件。`
  );
  return lines.join('\n');
}

/** 拿到某人设的开场白（若有）。 */
export function greetingOf(persona) {
  return parseCard(persona).greeting || '';
}

// ==== 供 API 使用的 CRUD 包装 ====
export function listPersonas() {
  return personas.list().map(withParsedCard);
}

export function getPersona(id) {
  const p = personas.get(id);
  return p ? withParsedCard(p) : null;
}

export function createPersona(card, avatar) {
  const name = (card.name || '未命名角色').trim();
  const created = personas.create({ name, cardJson: JSON.stringify(card), avatar });
  return withParsedCard(created);
}

export function updatePersona(id, card, avatar) {
  const name = (card.name || '未命名角色').trim();
  const updated = personas.update(id, { name, cardJson: JSON.stringify(card), avatar });
  return withParsedCard(updated);
}

export function deletePersona(id) {
  personas.remove(id);
}

function withParsedCard(persona) {
  return {
    id: persona.id,
    name: persona.name,
    avatar: persona.avatar,
    created_at: persona.created_at,
    card: parseCard(persona),
  };
}
