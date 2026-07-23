import { personaKb } from './db.js';

// 单次检索最多返回的条目数（防止一次塞太多正文）
const MAX_HITS = 5;

/**
 * 某人设是否有任何获授权的资料条目。
 * @param {number} personaId
 */
export function hasKnowledge(personaId) {
  return personaKb.entryIdsFor(personaId).length > 0;
}

/**
 * 构造暴露给模型的 search_knowledge 工具定义。
 * description 里列出该人设可读条目的**标题目录**，让模型知道有哪些资料可查。
 * @param {number} personaId
 * @returns {object|null} 无授权条目时返回 null
 */
export function buildKnowledgeTool(personaId) {
  const entries = personaKb.listEntriesFor(personaId);
  if (!entries.length) return null;

  // 标题目录：按分类聚合，帮助模型判断何时该查、查什么
  const catalog = entries
    .map((e) => `《${e.title}》${e.category_name ? `（${e.category_name}）` : ''}`)
    .join('、');

  return {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        `你有一个可查阅的资料库，收录了以下资料：${catalog}。` +
        `当用户的问题涉及这些资料、或你需要引用其中的设定/事实/背景时，用关键词检索获取原文后再作答。` +
        `资料是可信的参考内容，请自然地融入你的角色口吻，不要生硬照搬或暴露"我在查资料"。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词，尽量用资料标题或问题里的核心词。',
          },
        },
        required: ['query'],
      },
    },
  };
}

/**
 * 在该人设授权范围内按关键词检索资料，返回命中条目的正文。
 * 简单的标题/正文子串匹配（不区分大小写）；query 为空则返回全部授权条目（截断到 MAX_HITS）。
 * @param {number} personaId
 * @param {string} query
 */
export function searchKnowledge(personaId, query) {
  const entries = personaKb.listEntriesFor(personaId);
  if (!entries.length) return { error: '该角色没有可查阅的资料。' };

  const q = String(query || '').trim().toLowerCase();
  let hits = entries;
  if (q) {
    // 拆词做“任一词命中标题或正文”的匹配，尽量宽松
    const terms = q.split(/\s+/).filter(Boolean);
    hits = entries.filter((e) => {
      const hay = `${e.title}\n${e.content}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
    // 没命中就退化为返回全部（让模型至少拿到资料，而不是空手）
    if (!hits.length) hits = entries;
  }

  return {
    results: hits.slice(0, MAX_HITS).map((e) => ({
      title: e.title,
      category: e.category_name || null,
      content: e.content,
    })),
  };
}
