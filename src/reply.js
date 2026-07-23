import { streamChat } from './llm.js';
import { SentenceSegmenter } from './segmenter.js';

// 每次回复最多推送的表情包数量（控制表情包频率）
export const MAX_STICKERS_PER_REPLY = 1;

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
 * @param {number} [maxStickers] 本次回应的表情包上限
 */
export async function streamReply({ messages, onSentence, onSticker, onToolCall, onFile, personaId, maxStickers = MAX_STICKERS_PER_REPLY }) {
  const segmenter = new SentenceSegmenter();
  let stickerCount = 0;

  const flushSentence = (raw) => {
    const text = raw.trim();
    if (text) onSentence(text);
  };

  await streamChat({
    messages,
    personaId,
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
