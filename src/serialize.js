// [复用模块] 消息内容的两类序列化：
//   contentView   → 面向前端渲染（表情包/文件/文本三种 kind）
//   modelText     → 面向模型与摘要/导出的自然语言文本（把内部标记翻成人话）
// 集中处理「表情包标记 / 文件标记 / 普通文本」与「群成员对外字段」这些到处重复的分支。

import { parseStickerContent } from './stickers.js';
import { parseFileContent } from './files.js';

/**
 * 把一条消息的 content 解析成前端渲染视图。
 * 表情包标记 → { kind:'sticker', sticker:{id,file} }；
 * 文件标记 → { kind:'file', file:{id,filename,format} }；普通文本 → { kind:'text' }。
 * @param {string} content
 */
export function contentView(content) {
  const sticker = parseStickerContent(content);
  if (sticker) return { kind: 'sticker', sticker: { id: sticker.id, file: sticker.file } };
  const file = parseFileContent(content);
  if (file) return { kind: 'file', file };
  return { kind: 'text' };
}

/**
 * [复用模块] 把一条消息的 content 翻成「喂给模型/摘要/导出」的自然语言文本。
 *
 * 内部标记（\x01STICKER: / \x01FILE:）绝不能原样下发给模型——模型会照抄格式，
 * 把字面量当正文输出（连 UUID 一起抄），前端就会渲染出一串裸标记。
 *
 * @param {string} content 原始 DB content
 * @param {object} [opts]
 * @param {'user'|'assistant'} [opts.role] 说话人角色，决定第一人称措辞
 * @param {string} [opts.who] 第三人称称呼（群聊转录用；给了就用它代替"我"）
 * @returns {string|null} null 表示这条消息不必进上下文（assistant 自己发的表情包）
 */
export function modelText(content, { role = 'assistant', who = '' } = {}) {
  const self = who || '我';
  const sticker = parseStickerContent(content);
  if (sticker) {
    // assistant 自己发的表情包不回喂（原 shortTerm 行为），群聊转录里给了 who 则照常描述
    if (role === 'assistant' && !who) return null;
    return `[${self}发送了一个表情：${sticker.emotion || sticker.id}]`;
  }
  const file = parseFileContent(content);
  if (file) {
    // 只保留文件名，绝不暴露内部 id
    return `[${self}发送了一个文件：${file.filename}]`;
  }
  return content;
}

/**
 * 群成员对外结构（只暴露前端需要的字段）。
 * @param {{id:number, name:string, avatar?:string|null}} m 人设行
 */
export function publicMember(m) {
  return { id: m.id, name: m.name, avatar: m.avatar || null };
}

/**
 * 群消息里的说话人对外结构；user 消息（无 speaker_persona_id）返回 null。
 * @param {{speaker_persona_id?:number, speaker_name?:string, speaker_avatar?:string|null}} m 群消息行（已 join 说话人）
 */
export function publicSpeaker(m) {
  if (!m.speaker_persona_id) return null;
  return { personaId: m.speaker_persona_id, name: m.speaker_name, avatar: m.speaker_avatar || null };
}

// 时间戳（毫秒）格式化成 "YYYY-MM-DD HH:mm:ss"（本地时区）
function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 一条消息的 Markdown 内容：表情包/文件渲染成斜体动作标注（说话人名字已在上方标题里，
// 这里不重复带称呼），其余为原文；内部换行补引用前缀
function mdQuote(m) {
  const sticker = parseStickerContent(m.content);
  const file = parseFileContent(m.content);
  let text = m.content;
  if (sticker) text = `*[表情：${sticker.emotion || sticker.id}]*`;
  else if (file) text = `*[文件：${file.filename}]*`;
  return text.split('\n').map((l) => `> ${l}`).join('\n');
}

/**
 * [复用模块] 把群聊记录导出成 Markdown 转录稿。
 * 连续同一说话人的消息归为一组（与聊天界面一致），组内每条渲染为独立引用段落。
 * @param {{name:string}} group 群组
 * @param {{name:string}[]} members 成员（含 name）
 * @param {object[]} messages 群消息行（listByGroup 结果，含 speaker_name / speaker_persona_id / created_at）
 * @param {number} exportedAt 导出时刻（毫秒）
 * @returns {string} Markdown 文本
 */
export function groupTranscriptMarkdown(group, members, messages, exportedAt) {
  const lines = [
    `# 群聊记录：${group.name}`,
    '',
    `- **成员**：${members.map((m) => m.name).join('、')}`,
    `- **导出时间**：${fmtTime(exportedAt)}`,
    `- **消息条数**：${messages.length}`,
    '',
    '---',
    '',
  ];

  // 按「连续同一说话人」分组：用户为一类，assistant 按 speaker_persona_id 区分
  let group0 = [];
  let prevKey = null;
  const flush = () => {
    if (!group0.length) return;
    const first = group0[0];
    const who = first.role === 'user' ? '用户' : (first.speaker_name || '某成员');
    lines.push(`**${who}** · \`${fmtTime(first.created_at)}\``, '');
    // 组内各条之间用 "> "（空引用行）分段，渲染成引用块里的多个段落
    lines.push(group0.map(mdQuote).join('\n>\n'), '');
    group0 = [];
  };

  for (const m of messages) {
    const key = m.role === 'user' ? 'user' : `p${m.speaker_persona_id}`;
    if (key !== prevKey) { flush(); prevKey = key; }
    group0.push(m);
  }
  flush();

  return lines.join('\n');
}
