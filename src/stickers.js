import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stickersPath = join(__dirname, '..', 'public', 'stickers', 'stickers.json');

let stickers = [];
try {
  const raw = JSON.parse(readFileSync(stickersPath, 'utf-8'));
  stickers = Array.isArray(raw.stickers) ? raw.stickers : [];
} catch (err) {
  console.warn('[stickers] 读取 stickers.json 失败，表情包功能不可用：', err.message);
}

/** 是否有可用表情包。 */
export const hasStickers = stickers.length > 0;

// 表情包作为独立消息落库时的内容标记：\x01STICKER:<id>
const STICKER_PREFIX = '\x01STICKER:';

/** 把表情包 id 编码成可落库的消息内容。 */
export function stickerContent(id) {
  return STICKER_PREFIX + id;
}

/** 若消息内容是表情包标记则返回其 sticker 元数据，否则返回 null。 */
export function parseStickerContent(content) {
  if (typeof content !== 'string' || !content.startsWith(STICKER_PREFIX)) return null;
  return getSticker(content.slice(STICKER_PREFIX.length));
}

/** 表情包数量。 */
export const stickerCount = stickers.length;

/** 按 id 查表情包元数据。 */
export function getSticker(id) {
  return stickers.find((s) => s.id === id) || null;
}

/**
 * 构造暴露给模型的 send_sticker 工具。
 * 把每个表情包的情绪含义写进 description，让模型按情绪挑选。
 */
export function buildStickerTool() {
  const ids = stickers.map((s) => s.id);
  const catalog = stickers.map((s) => `${s.id}(${s.emotion})`).join('、');
  return {
    type: 'function',
    function: {
      name: 'send_sticker',
      description:
        `偶尔在情绪特别强烈时发送一个表情包点缀对话。可选表情包及其情绪含义：${catalog}。` +
        `请克制使用：一次回复最多发一个，多数回复不需要发。表情包是文字的补充，务必照常输出文字，不要用表情包代替说话。`,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            enum: ids,
            description: '要发送的表情包 id',
          },
        },
        required: ['id'],
      },
    },
  };
}
