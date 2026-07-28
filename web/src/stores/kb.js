// 资料库：分类 + 条目。取代旧 app.js:1084-1241 的 9 个函数。
// 沿用原有产品约定：
//   - 分类只做增删，不作导航层级（条目列表始终展示全部条目，靠标签标注所属分类）
//   - 新建条目必须已有至少一个分类（后端 POST /api/kb/entries 强校验 categoryId）
//   - 编辑时可改成「未分类」（后端 PUT 允许 categoryId 为 null）
import { reactive } from 'vue';
import { api, endpoints } from '../api/index.js';

export const kb = reactive({
  categories: [],
  entries: [], // 全部条目，含 join 出来的 category_name
  activeEntryId: null,
  // 条目编辑器的草稿：与列表数据分离，保存成功后才回写
  draft: { title: '', content: '', categoryId: null },
  saved: false, // 保存后的轻提示（原 flashEntrySaved）
});

export async function loadCategories() {
  kb.categories = await api.get(endpoints.kbCategories);
  await loadEntries();
}

export async function loadEntries() {
  kb.entries = await api.get(endpoints.kbEntries);
}

export async function createCategory(name) {
  const v = (name || '').trim();
  if (!v) return;
  await api.send('POST', endpoints.kbCategories, { name: v });
  await loadCategories();
}

export async function removeCategory(id) {
  await api.send('DELETE', endpoints.kbCategory(id));
  // 分类删除会级联删掉其下条目，当前打开的条目可能已不存在，直接收起编辑器
  if (kb.activeEntryId) closeEntry();
  await loadCategories();
}

export function selectEntry(id) {
  const entry = kb.entries.find((e) => e.id === id);
  if (!entry) return;
  kb.activeEntryId = id;
  kb.draft = {
    title: entry.title,
    content: entry.content || '',
    categoryId: entry.category_id ?? null,
  };
}

export function closeEntry() {
  kb.activeEntryId = null;
  kb.draft = { title: '', content: '', categoryId: null };
}

// 新建条目：默认落到第一个分类（后端不接受未分类的新建）
export async function createEntry() {
  const categoryId = kb.categories[0]?.id ?? null;
  if (!categoryId) throw new Error('请先新建至少一个分类');
  const entry = await api.send('POST', endpoints.kbEntries, {
    categoryId,
    title: '新条目',
    content: '',
  });
  await loadEntries();
  selectEntry(entry.id);
  return entry;
}

export async function saveEntry() {
  if (!kb.activeEntryId) return;
  const title = kb.draft.title.trim();
  if (!title) throw new Error('请填写条目标题');
  // 必须带分类：kb_entries.category_id 是 NOT NULL，传 null 后端会静默跳过该列而假装成功
  if (kb.draft.categoryId == null) throw new Error('请为条目选择分类');
  await api.send('PUT', endpoints.kbEntry(kb.activeEntryId), {
    title,
    content: kb.draft.content,
    categoryId: kb.draft.categoryId,
  });
  await loadEntries();
  kb.draft.title = title; // 回写 trim 后的标题，与列表保持一致
  flashSaved();
}

export async function removeEntry(id) {
  await api.send('DELETE', endpoints.kbEntry(id));
  if (kb.activeEntryId === id) closeEntry();
  await loadEntries();
}

// 保存后的短暂「已保存」反馈，1.2 秒后复原（原 flashEntrySaved 借按钮文字实现）
let savedTimer = null;
function flashSaved() {
  kb.saved = true;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    kb.saved = false;
    savedTimer = null;
  }, 1200);
}
