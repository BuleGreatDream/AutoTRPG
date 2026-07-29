// 聊天室核心状态。取代旧 app.js state 对象里与聊天相关的字段及所有 CRUD 函数。
// 注意：sendingKeys 是 Set，reactive() 不会自动深层代理 Set 的方法；
// 这里的并发锁用普通 Set + 手动触发渲染的方式，由 useChatStream.js 通过 key()
// 判断当前会话是否忙碌。
import { reactive } from 'vue';
import { api, endpoints } from '../api/index.js';
import { personaSpeaker, speakerKey } from '../composables/useAvatar.js';

// 删除弹窗的文案与接口配置（原 app.js DELETE_KINDS）
export const DELETE_KINDS = {
  session: {
    title: '删除会话',
    msg: '删除这段会话前，是否把它归纳保留为该人设的长期记忆？',
    hint: '选择「保留」会让 AI 记住这段对话的要点，跨会话延续。',
    url: (id) => `/api/sessions/${id}`,
    doneMsg: '会话已删除',
  },
  group: {
    title: '删除群聊',
    msg: '删除这个群聊前，是否把这段对话分别归纳保留进每个成员的长期记忆？',
    hint: '选择「保留」会让群里每个 AI 各自记住这段群聊的要点，之后单聊或别的群也能延续。',
    url: (id) => `/api/groups/${id}`,
    doneMsg: '群聊已删除',
  },
};

export const chat = reactive({
  personas: [],
  sessions: [],
  groups: [],
  // 激活态
  activePersonaId: null,
  activeSessionId: null,
  activeGroupId: null,
  activeMode: null, // 'single' | 'group'
  loaded: false,        // initChat 完成后置 true，防止空数据被误认为"丢失"
  loadError: '',        // 非空表示初始化失败
  // 消息与流
  messages: [],          // 当前渲染的消息列表（每次切会话/群聊时全量替换）
  messagesLoading: false,
  // 头部
  chatTitle: '选择或创建一个人设开始聊天',
  chatStatusText: '',
  chatStatusVisible: false,
  // 特性标签
  features: {},
  // 表情包目录
  stickers: [],
  // 弹窗开关（ChatPane 设，ChatView 读）
  _showDelete: false,
  _showGroupModal: false,
  // 流式回应锁：由 useChatStream.js 读写。不能用 reactive Set，这里用普通对象 { [key]: true }
  _sendingKeys: {},
  // 删除弹窗
  deleteTarget: null, // { kind: 'session'|'group', id, name? }
  // 群聊资料弹窗
  groupKbModalGroupId: null,
});

// ===== 导出给组件用的纯函数 =====

// 当前聊天上下文的唯一键。替代旧 app.js chatKey()。
export function chatKey(mode = chat.activeMode, sid = chat.activeSessionId, gid = chat.activeGroupId) {
  if (mode === 'single' && sid) return `single:${sid}`;
  if (mode === 'group' && gid) return `group:${gid}`;
  return null;
}

export function currentChatKey() {
  return chatKey();
}

export function isSending(key) {
  return key ? Boolean(chat._sendingKeys[key]) : false;
}

export function findPersona(id) {
  return chat.personas.find((p) => p.id === id) || null;
}

// 1v1 下默认说话人（当前人设）
export function defaultSpeaker() {
  const p = findPersona(chat.activePersonaId);
  return personaSpeaker(p);
}

// 把 chat.messages[] 包装成渲染就绪的列表：注入 showHead / isGroup / defaultSpeaker。
// 连续同一 assistant 说话人只在第一条显示头像与名字。
export function renderMessages() {
  const isGroup = chat.activeMode === 'group';
  const defSpk = isGroup ? null : defaultSpeaker();
  let lastSid = null;
  return chat.messages.map((m) => {
    const speaker = m.speaker || defSpk;
    const sid = speakerKey(speaker);
    const showHead = m.role === 'assistant' && sid !== lastSid;
    if (m.role === 'assistant') lastSid = sid;
    return { ...m, speaker, showHead, isGroup };
  });
}

// ===== 初始化 =====
export async function initChat() {
  // 特性标签（失败不阻塞主流程）
  try {
    chat.features = await api.get(endpoints.features);
    if (chat.features.stickers) {
      try { chat.stickers = await api.get(endpoints.stickers); } catch { /* sticker 加载失败不影响聊天 */ }
    }
  } catch (err) {
    console.warn('[chat] 加载 features 失败：', err.message);
  }
  try {
    await loadPersonas();
    await loadGroups();
    chat.loaded = true;
  } catch (err) {
    console.error('[chat] 初始化失败：', err.message);
    chat.loadError = err.message;
    chat.chatTitle = '数据加载失败，请确认后端已启动（npm run dev:server）';
  }
}

// ===== 人设卡 =====
export async function loadPersonas() {
  chat.personas = await api.get(endpoints.personas);
}

export async function selectPersona(id) {
  chat.activePersonaId = id;
  chat.activeSessionId = null;
  chat.activeGroupId = null;
  chat.activeMode = null;
  chat.messages = [];
  chat.chatTitle = '从上方新建一个会话开始对话';
  chat.chatStatusText = '';
  chat.chatStatusVisible = false;
  await loadSessions();
}

// ===== 会话 =====
export async function loadSessions() {
  if (!chat.activePersonaId) { chat.sessions = []; return; }
  chat.sessions = await api.get(endpoints.sessionsOf(chat.activePersonaId));
}

export async function createSession() {
  if (!chat.activePersonaId) return;
  const persona = findPersona(chat.activePersonaId);
  const session = await api.send('POST', endpoints.sessions, {
    personaId: chat.activePersonaId,
    title: `与${persona.name}的对话`,
  });
  await loadSessions();
  await selectSession(session.id);
}

export async function selectSession(id) {
  chat.activeSessionId = id;
  chat.activeMode = 'single';
  chat.activeGroupId = null;
  const persona = findPersona(chat.activePersonaId);
  chat.chatTitle = persona ? persona.name : '会话';
  await loadMessagesForSession(id);
}

export async function loadMessagesForSession(id) {
  chat.messagesLoading = true;
  try {
    chat.messages = await api.get(endpoints.sessionMessages(id));
  } finally {
    chat.messagesLoading = false;
  }
}

// ===== 群聊 =====
export async function loadGroups() {
  chat.groups = await api.get(endpoints.groups);
}

export async function selectGroup(id) {
  chat.activeGroupId = id;
  chat.activeMode = 'group';
  chat.activePersonaId = null;
  chat.activeSessionId = null;
  const g = chat.groups.find((g) => g.id === id);
  const memberNames = g ? g.members.map((m) => m.name).join('、') : '';
  chat.chatTitle = g ? `${g.name}（${memberNames}）` : '群聊';
  await loadMessagesForGroup(id);
}

export async function loadMessagesForGroup(id) {
  chat.messagesLoading = true;
  try {
    chat.messages = await api.get(endpoints.groupMessages(id));
  } finally {
    chat.messagesLoading = false;
  }
}

// ===== 群文件上传 =====
// 允许的扩展名与后端 groupfile.js TEXT_EXTS 保持一致
export const GROUP_FILE_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json'];
export const GROUP_FILE_ACCEPT = GROUP_FILE_EXTS.map((e) => `.${e}`).join(',');
const GROUP_FILE_MAX_BYTES = 1024 * 1024; // 与后端 MAX_CONTENT_BYTES 一致

function extOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 逐个上传文本文件到当前群的资料库（转成条目并授权给该群）。
 * 单个文件失败不影响其余文件。
 * @param {number} groupId
 * @param {File[]} files
 * @returns {Promise<{ok:{name:string,created:boolean,category:string}[], fail:{name:string,error:string}[]}>}
 */
export async function uploadGroupFiles(groupId, files) {
  const ok = [];
  const fail = [];
  for (const file of files) {
    try {
      const ext = extOf(file.name);
      if (ext && !GROUP_FILE_EXTS.includes(ext)) throw new Error(`不支持的文件类型 .${ext}`);
      if (file.size > GROUP_FILE_MAX_BYTES) throw new Error('文件过大（上限 1MB）');
      const text = await file.text();
      if (!text.trim()) throw new Error('文件内容为空');
      const res = await api.sendText(endpoints.groupFiles(groupId, file.name), text);
      ok.push({ name: file.name, created: res.created, category: res.category?.name || '' });
    } catch (err) {
      fail.push({ name: file.name, error: err.message });
    }
  }
  return { ok, fail };
}

// ===== 删除 =====
export async function performDelete(summarize) {
  const t = chat.deleteTarget;
  if (!t) return;
  const cfg = DELETE_KINDS[t.kind];
  try {
    await api.send('DELETE', cfg.url(t.id), { summarize });
  } catch (err) {
    throw err; // 调用方决定是否重试
  }
  if (t.kind === 'session' && chat.activeSessionId === t.id) {
    chat.activeSessionId = null;
    chat.activeMode = null;
    chat.messages = [];
  } else if (t.kind === 'group' && chat.activeGroupId === t.id) {
    chat.activeGroupId = null;
    chat.activeMode = null;
    chat.messages = [];
  }
  // 刷新列表
  if (t.kind === 'session') await loadSessions();
  else await loadGroups();
}
