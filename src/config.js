import 'dotenv/config';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // 大模型（OpenAI 兼容）
  chat: {
    baseUrl: (process.env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.CHAT_MODEL || 'gpt-4o-mini',
  },
  // Tavily 联网搜索
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || '',
  },
  // 服务
  server: {
    port: num(process.env.PORT, 3000),
    host: process.env.HOST || '127.0.0.1',
  },
  // 记忆参数
  memory: {
    // 短期记忆：注入的最近消息条数；超出的旧消息会被归纳进长期摘要
    shortTermMessages: num(process.env.SHORT_TERM_MESSAGES, 20),
  },
};

// 能力开关
export const features = {
  webSearch: Boolean(config.tavily.apiKey),
  // 摘要式长期记忆：默认开启，可用 ENABLE_LONG_TERM=false 关闭
  longTermMemory: (process.env.ENABLE_LONG_TERM || 'true').toLowerCase() !== 'false',
  // 开放注册：默认开启。服务只监听本机时风险低；若要放到内网，设 false 关掉注册入口
  allowRegister: (process.env.ALLOW_REGISTER || 'true').toLowerCase() !== 'false',
};

export function assertChatConfig() {
  if (!config.chat.baseUrl || !config.chat.apiKey) {
    throw new Error('缺少大模型配置：请在 .env 中设置 OPENAI_BASE_URL 与 OPENAI_API_KEY');
  }
}
