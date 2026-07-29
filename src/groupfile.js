// 群文件导入：把用户在群聊里上传的文本文件转成资料库条目，并授权给该群。
//
// 规则（与产品约定一致）：
//   - 分类名固定为「{群名}群文件」，不存在则自动创建；
//   - 条目标题取文件名（去扩展名），同分类下同名条目视为“更新”而非新增；
//   - 授权走 groupKb.addFor 增量追加，不碰该群已有的手工勾选。
import { groups, kbCategories, kbEntries, groupKb } from './db.js';

// 允许上传的纯文本扩展名（与前端 accept 保持一致）
export const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json'];

// 单个文件正文上限：约 200 万字符纯文本已远超模型可用范围，这里按 1MB 收口
export const MAX_CONTENT_BYTES = 1024 * 1024;

/** 该群对应的资料分类名。 */
export function categoryNameOf(group) {
  return `${group.name}群文件`;
}

/** 从文件名推出条目标题：去扩展名、去路径与危险字符、限长。 */
export function titleFromFilename(filename) {
  let base = String(filename || '').trim();
  base = base.replace(/^.*[\\/]/, ''); // 去掉可能带的路径
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (TEXT_EXTS.includes(ext)) base = base.slice(0, dot);
  }
  base = base.replace(/[\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  if (!base) base = '未命名文件';
  return base.length > 80 ? base.slice(0, 80) : base;
}

/** 取（或创建）该群的资料分类。 */
function ensureCategory(group) {
  const name = categoryNameOf(group);
  return kbCategories.findByName(name) || kbCategories.create({ name });
}

/**
 * 导入一个文本文件到该群的资料库。
 * @param {number} groupId
 * @param {string} filename 原始文件名
 * @param {string} content  文件文本内容
 * @returns {{entry:object, category:object, created:boolean}} created=false 表示覆盖了同名条目
 */
export function importGroupFile(groupId, filename, content) {
  const group = groups.get(groupId);
  if (!group) throw new Error('群组不存在');

  const text = String(content ?? '');
  if (!text.trim()) throw new Error('文件内容为空');

  const category = ensureCategory(group);
  const title = titleFromFilename(filename);

  const existing = kbEntries.findInCategory(category.id, title);
  const entry = existing
    ? kbEntries.update(existing.id, { title, content: text, categoryId: category.id })
    : kbEntries.create({ categoryId: category.id, title, content: text });

  // 无论新建还是覆盖都补一次授权：覆盖场景下该条目可能曾被取消勾选
  groupKb.addFor(groupId, [entry.id]);

  return { entry, category, created: !existing };
}
