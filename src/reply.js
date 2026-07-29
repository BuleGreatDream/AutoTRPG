import { streamChat } from './llm.js';
import { SentenceSegmenter } from './segmenter.js';

// 每次回复最多推送的表情包数量（控制表情包频率）
export const MAX_STICKERS_PER_REPLY = 1;

// 模型照抄内部标记字面量的形态：可能带 \x01 前缀，也可能只有 FILE:{...} / STICKER:xxx。
// 真实的文件/表情包消息由 onFile/onSticker 独立落库，正文里出现这种串一律是模仿，不是内容。
const MARKER_MIMICRY = /\x01?(?:FILE:\s*\{[^}]*\}|STICKER:\s*[A-Za-z0-9_-]+)/g;

/** 剥掉正文里被模型照抄出来的内部标记字面量。 */
export function stripMarkerMimicry(text) {
  if (!text.includes('FILE:') && !text.includes('STICKER:')) return text;
  return text.replace(MARKER_MIMICRY, '').trim();
}

/**
 * 单个 assistant 的一次完整回应：流式生成 → 逐句切分 → 表情包上限。
 *
 * 只负责把模型输出转换成「一句句文字 + 至多 N 个表情包」并通过回调吐出，
 * 至于落库/推送由调用方在回调里决定（1v1 与群聊的落库字段不同）。
 *
 * @param {object[]} messages   发给模型的上下文（含 system）
 * @param {(text:string)=>void} onSentence 每凑成一句完整的话时回调
 * @param {(sticker:object)=>void} [onSticker] 触发表情包时回调（已受上限约束）
 * @param {(name:string,args:object)=>void} [onToolCall] 工具调用回调（如联网搜索提示）
 * @param {number} [personaId] 作答人设 id，用于挂载资料检索工具
 * @param {number} [groupId] 群聊 id（群聊场景），其授权与人设授权合并检索
 * @param {number} [maxStickers] 本次回应的表情包上限
 */
export async function streamReply({ messages, onSentence, onSticker, onToolCall, onFile, personaId, groupId, maxStickers = MAX_STICKERS_PER_REPLY }) {
  const segmenter = new SentenceSegmenter();
  let stickerCount = 0;

  const flushSentence = (raw) => {
    let text = raw.trim();
    if (!text) return;
    // 兜底：模型有时会照抄内部标记的字面量当正文输出（历史上下文里见过就学）。
    // 这类文本一旦落库就渲染成一串裸标记，直接剥掉；剥完为空则整句丢弃。
    text = stripMarkerMimicry(text);
    if (text) onSentence(text);
  };

  await streamChat({
    messages,
    personaId,
    groupId,
    onToken: (token) => {
      for (const s of segmenter.push(token)) flushSentence(s);
    },
    onToolCall,
    onSticker: (sticker) => {
      // 表情包前先把已凑好的文字发出，保证顺序：文字在前、表情在后
      for (const s of segmenter.flush()) flushSentence(s);
      if (stickerCount >= maxStickers) return; // 超过上限则丢弃，控制频率
      stickerCount++;
      onSticker?.(sticker);
    },
    onFile: (meta) => {
      // 文件卡片前先把已凑好的文字发出，保证顺序：说明文字在前、文件在后
      for (const s of segmenter.flush()) flushSentence(s);
      onFile?.(meta);
    },
  });

  // 收尾：吐出残留的最后一句
  for (const s of segmenter.flush()) flushSentence(s);
}
