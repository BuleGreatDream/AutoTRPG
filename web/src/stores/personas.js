// 人设卡。取代旧 app.js 的 loadPersonas / openPersonaEditor / savePersona /
// deletePersonaFromModal / renderPersonaKbList 等。
//
// 头像的三态语义沿用旧实现，但改用显式的 avatarTouched 标记，不再靠 undefined 区分：
//   avatarTouched=false          → 未改动，保存时沿用原头像
//   avatarTouched=true, 值为字符串 → 换了新图（data URL）
//   avatarTouched=true, 值为 null  → 显式移除
import { reactive, computed } from 'vue';
import { api, endpoints } from '../api/index.js';

const EMPTY_CARD = {
  name: '', persona: '', background: '', speakingStyle: '', greeting: '', extra: '',
};

export const personas = reactive({
  list: [],
  editingId: null,   // 正在编辑的人设 id；null 且 editorOpen 为真表示「新建」
  editorOpen: false,
  draft: { ...EMPTY_CARD },
  avatarDraft: null,
  avatarTouched: false,
  kbEntryIds: [],    // 该人设已授权的资料条目 id
  saving: false,
  // 长期记忆（滚动摘要，每人设一条）。只能整体清空——归纳时新旧摘要已融合覆盖，
  // 不保留来源会话，无法按会话删除。
  memory: { summary: '', updatedAt: null, state: 'idle', clearing: false },
});

// 编辑器里当前该显示的头像：改过就用草稿，没改过就用列表里的原值
export const editingAvatar = computed(() => {
  if (personas.avatarTouched) return personas.avatarDraft;
  const p = personas.list.find((x) => x.id === personas.editingId);
  return p?.avatar ?? null;
});

export async function loadPersonas() {
  personas.list = await api.get(endpoints.personas);
}

export function findPersona(id) {
  return personas.list.find((p) => p.id === id) || null;
}

// 打开编辑器。persona 为 null 表示新建。
export async function openEditor(persona) {
  personas.editingId = persona?.id ?? null;
  personas.editorOpen = true;
  personas.draft = { ...EMPTY_CARD, ...(persona?.card || {}) };
  personas.avatarDraft = null;
  personas.avatarTouched = false;
  personas.kbEntryIds = [];
  resetMemory();
  if (persona) {
    loadMemory(persona.id); // 不 await：记忆是附属信息，不该拖慢编辑器打开
    try {
      const res = await api.get(endpoints.personaKb(persona.id));
      // 组件可能已切到别的人设，回来时确认还在编辑同一张卡再写入
      if (personas.editingId === persona.id) personas.kbEntryIds = res.entryIds || [];
    } catch {
      // 授权读取失败不阻塞编辑，保持空勾选
    }
  }
}

export function closeEditor() {
  personas.editingId = null;
  personas.editorOpen = false;
  personas.draft = { ...EMPTY_CARD };
  personas.avatarDraft = null;
  personas.avatarTouched = false;
  personas.kbEntryIds = [];
  resetMemory();
}

export function setAvatar(dataUrl) {
  personas.avatarDraft = dataUrl;
  personas.avatarTouched = true;
}

export function clearAvatar() {
  personas.avatarDraft = null;
  personas.avatarTouched = true;
}

export async function savePersona() {
  const card = {};
  for (const k of Object.keys(EMPTY_CARD)) card[k] = (personas.draft[k] || '').trim();
  if (!card.name) throw new Error('请填写角色名字');

  personas.saving = true;
  try {
    let id = personas.editingId;
    if (id) {
      const existing = findPersona(id);
      const avatar = personas.avatarTouched ? personas.avatarDraft : (existing?.avatar ?? null);
      await api.send('PUT', endpoints.persona(id), { card, avatar });
    } else {
      const created = await api.send('POST', endpoints.personas, {
        card,
        avatar: personas.avatarTouched ? personas.avatarDraft : null,
      });
      id = created.id;
    }
    // 资料授权按条目全量覆盖
    try {
      await api.send('PUT', endpoints.personaKb(id), { entryIds: personas.kbEntryIds });
    } catch {
      // 资料库可能为空，忽略
    }
    await loadPersonas();
    return id;
  } finally {
    personas.saving = false;
  }
}

// ===== 长期记忆 =====
function resetMemory() {
  personas.memory = { summary: '', updatedAt: null, state: 'idle', clearing: false };
}

export async function loadMemory(personaId) {
  personas.memory = { summary: '', updatedAt: null, state: 'loading', clearing: false };
  try {
    const res = await api.get(endpoints.personaMemory(personaId));
    // 期间可能已切到别的人设，回来时确认还在编辑同一张卡再写入
    if (personas.editingId !== personaId) return;
    personas.memory = {
      summary: res.summary || '', updatedAt: res.updatedAt || null,
      state: 'ready', clearing: false,
    };
  } catch {
    if (personas.editingId === personaId) personas.memory.state = 'error';
  }
}

/** 清空该人设的全部长期记忆。调用方负责二次确认。 */
export async function clearMemory(personaId) {
  personas.memory.clearing = true;
  try {
    await api.send('DELETE', endpoints.personaMemory(personaId));
    if (personas.editingId === personaId) {
      personas.memory = { summary: '', updatedAt: null, state: 'ready', clearing: false };
    }
  } finally {
    if (personas.memory) personas.memory.clearing = false;
  }
}

export async function deletePersona(id) {
  await api.send('DELETE', endpoints.persona(id));
  await loadPersonas();
}
