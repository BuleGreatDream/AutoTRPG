// 把流式 token 切成一句一句，模拟人与人聊天时逐句发送。
// 句末标点（中英文）与换行都作为切分边界。

const ENDERS = new Set(['。', '！', '？', '!', '?', '…', '；', ';']);
// 紧跟在句末标点后、应与其归为同一句的收尾字符（引号、括号等）
const TRAILERS = new Set(['”', '"', '’', "'", '）', ')', '」', '』', '】', '》']);

/**
 * 逐 token 喂入，成句即产出。跨多轮 tool-call 复用同一实例即可。
 */
export class SentenceSegmenter {
  constructor() {
    this.buffer = '';
  }

  /**
   * 喂入一段文本增量，返回本次凑成的完整句子数组（可能为空）。
   */
  push(text) {
    if (!text) return [];
    this.buffer += text;
    return this.#drain();
  }

  /** 流结束时调用，吐出残留的最后一句（若有）。 */
  flush() {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }

  #drain() {
    const out = [];
    let start = 0;
    const buf = this.buffer;

    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      const isEnder = ENDERS.has(ch);
      const isNewline = ch === '\n';
      if (!isEnder && !isNewline) continue;

      // 句末标点后可能还跟着引号/括号，一并纳入本句
      let end = i;
      if (isEnder) {
        while (end + 1 < buf.length && TRAILERS.has(buf[end + 1])) end++;
        // 收尾字符恰好在缓冲末尾：等下一个 token，避免把引号拆成独立一句
        if (end + 1 >= buf.length && TRAILERS.has(buf[end])) break;
      }

      const sentence = buf.slice(start, end + 1).trim();
      if (sentence) out.push(sentence);
      start = end + 1;
      i = end;
    }

    this.buffer = buf.slice(start);
    return out;
  }
}

