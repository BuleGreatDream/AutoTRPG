import { config, features } from './config.js';

/** 暴露给模型的 function calling 工具定义。 */
export const webSearchTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '联网搜索工具。仅在确有必要时才调用：需要实时/最新信息、你不确定或超出知识范围的具体事实、' +
      '用户明确要求查资料时。日常闲聊、寒暄、依据人设和常识就能回答的问题不要调用。' +
      '支持两种模式：不填 domains 时在全网广泛搜索；填 domains 时只在这些网站内搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，尽量精炼、聚焦。',
        },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description:
            '可选。限定搜索范围的网站域名列表（如 ["zhihu.com","github.com"]）。' +
            '仅当用户指定了要在某些网站内查找、或该问题在特定权威站点更可靠时才填；否则留空做全网搜索。',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * 调用 Tavily 搜索，返回给模型消费的精简结果。
 * 返回内容视为不可信数据，仅作为参考资料回填。
 * @param {string} query 搜索关键词
 * @param {string[]} [domains] 可选，限定搜索的域名列表（走 Tavily include_domains）
 */
export async function tavilySearch(query, domains) {
  if (!features.webSearch) {
    return { error: '联网搜索未启用（缺少 TAVILY_API_KEY）。' };
  }

  // 规整域名：去空白、去空项、去重
  const includeDomains = Array.isArray(domains)
    ? [...new Set(domains.map((d) => String(d).trim()).filter(Boolean))]
    : [];

  const body = {
    query,
    search_depth: 'basic',
    max_results: 5,
    include_answer: true,
  };
  if (includeDomains.length) body.include_domains = includeDomains;

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 现行 Tavily API 用 Bearer 头认证（旧的请求体 api_key 已废弃）
      Authorization: `Bearer ${config.tavily.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `搜索失败 (${res.status}): ${detail.slice(0, 200)}` };
  }

  const data = await res.json();
  return {
    scope: includeDomains.length ? `限定域名：${includeDomains.join('、')}` : '全网搜索',
    answer: data.answer || null,
    results: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    })),
  };
}
