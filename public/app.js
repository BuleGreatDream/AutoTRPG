// ===== 状态 =====
const state = {
  personas: [],
  sessions: [],
  groups: [],
  activeView: 'chat', // 'chat' | 'personas' | 'kb' | 'settings'
  activePersonaId: null,
  activeSessionId: null,
  activeGroupId: null,
  activeMode: null, // 'single' | 'group'
  editingPersonaId: null, // 弹窗当前编辑的人设 id（null 表示新建）
  editingAvatar: undefined, // 人设弹窗里当前的头像值（data URL / 已有路径 / null 表示清除；undefined 表示未改动）
  deleteTarget: null, // 删除确认弹窗当前针对的目标 { kind:'session'|'group', id, name? }
  sending: false,
  // 资料库
  categories: [],
  entries: [],           // 当前分类下的条目
  activeCategoryId: null,
  activeEntryId: null,
};

// 删除弹窗针对会话/群聊的文案与接口差异（共用一个弹窗）
const DELETE_KINDS = {
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

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const personaList = $('persona-list');
const sessionList = $('session-list');
const groupList = $('group-list');
const messagesEl = $('messages');
const chatTitle = $('chat-title');
const chatStatus = $('chat-status');
const inputEl = $('input');
const sendBtn = $('send-btn');
const newSessionBtn = $('new-session-btn');
const featureBadges = $('feature-badges');
const exportBtn = $('export-btn');

// ===== API 封装 =====
const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async send(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
};

// [复用] 弹窗显隐 + 点击遮罩关闭。三个弹窗（人设卡/群聊/删除会话）共用。
const showModal = (id) => $(id).classList.remove('hidden');
const hideModal = (id) => $(id).classList.add('hidden');
// 绑定「点击弹窗外遮罩即关闭」：仅当点中遮罩自身（而非内部卡片）时触发 onClose
function bindModalBackdrop(id, onClose) {
  $(id).onclick = (e) => { if (e.target.id === id) onClose(); };
}

// ===== 视图切换 =====
function switchView(view) {
  state.activeView = view;
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.querySelectorAll('.pane-view').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.pane !== view);
  });
  document.querySelectorAll('.main-view').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.main !== view);
  });
  // 进入各板块时按需加载数据
  if (view === 'personas') renderPersonaManageList();
  if (view === 'kb') loadCategories();
  if (view === 'settings') loadSettings();
}

// ===== 初始化 =====
async function init() {
  await loadFeatures();
  await loadPersonas();
  await loadGroups();
  bindEvents();
}

async function loadFeatures() {
  try {
    const f = await api.get('/api/features');
    featureBadges.innerHTML = '';
    featureBadges.append(
      badge('联网搜索', f.webSearch),
      badge('长期记忆', f.longTermMemory),
      badge('表情包', f.stickers),
      badge('群聊', f.groupChat)
    );
  } catch { /* 忽略 */ }
}

function badge(label, on) {
  const el = document.createElement('span');
  el.className = 'badge' + (on ? '' : ' off');
  el.textContent = (on ? '● ' : '○ ') + label;
  return el;
}

// ===== 人设卡 =====
async function loadPersonas() {
  state.personas = await api.get('/api/personas');
  renderPersonas();
  renderPersonaManageList();
}

function renderPersonas() {
  personaList.innerHTML = '';
  for (const p of state.personas) {
    const li = document.createElement('li');
    li.className = p.id === state.activePersonaId ? 'active' : '';
    const avatar = makePersonaAvatar(p);
    const name = document.createElement('span');
    name.textContent = p.name;
    name.style.flex = '1';
    li.append(avatar, name);
    li.onclick = () => selectPersona(p.id);
    personaList.appendChild(li);
  }
}

// 人设卡管理界面的列表：整行点击即编辑
function renderPersonaManageList() {
  const list = $('persona-manage-list');
  list.innerHTML = '';
  if (!state.personas.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有人设卡，点右上角 ＋ 新建。';
    list.appendChild(li);
    return;
  }
  for (const p of state.personas) {
    const li = document.createElement('li');
    li.className = p.id === state.editingPersonaId ? 'active' : '';
    const avatar = makePersonaAvatar(p);
    const name = document.createElement('span');
    name.textContent = p.name;
    name.style.flex = '1';
    li.append(avatar, name);
    li.onclick = () => openPersonaEditor(p);
    list.appendChild(li);
  }
}

// [复用] 给一个圆形头像元素填充内容：有图用背景图，否则用名字首字兜底。
function fillAvatar(el, name, avatar) {
  if (avatar) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = (name || '?').trim().charAt(0);
  }
  return el;
}

// 侧边栏小头像
function makePersonaAvatar(p) {
  const el = document.createElement('span');
  el.className = 'persona-avatar';
  return fillAvatar(el, p.name, p.avatar);
}

async function selectPersona(id) {
  state.activePersonaId = id;
  state.activeSessionId = null;
  // 切到单聊模式，清理群聊激活态
  state.activeGroupId = null;
  state.activeMode = null;
  newSessionBtn.disabled = false;
  renderPersonas();
  renderGroups();
  clearMessages('从上方新建一个会话开始对话');
  disableComposer();
  exportBtn.classList.add('hidden'); // 选人设(未进群)隐藏导出按钮
  await loadSessions();
}

// ===== 会话 =====
async function loadSessions() {
  if (!state.activePersonaId) return;
  state.sessions = await api.get(`/api/sessions?personaId=${state.activePersonaId}`);
  renderSessions();
}

function renderSessions() {
  sessionList.innerHTML = '';
  for (const s of state.sessions) {
    const li = document.createElement('li');
    li.className = s.id === state.activeSessionId ? 'active' : '';
    const title = document.createElement('span');
    title.textContent = s.title;
    const del = document.createElement('span');
    del.className = 'edit';
    del.textContent = '删除';
    del.onclick = (e) => {
      e.stopPropagation();
      openDeleteModal('session', s.id);
    };
    li.append(title, del);
    li.onclick = () => selectSession(s.id);
    sessionList.appendChild(li);
  }
}

// ===== 删除确认弹窗（会话 / 群聊共用）=====
function openDeleteModal(kind, id) {
  state.deleteTarget = { kind, id };
  resetDeleteModalButtons();
  showModal('delete-modal');
}

function closeDeleteModal() {
  state.deleteTarget = null;
  hideModal('delete-modal');
}

function resetDeleteModalButtons() {
  const cfg = DELETE_KINDS[state.deleteTarget?.kind] || DELETE_KINDS.session;
  $('delete-keep').disabled = false;
  $('delete-plain').disabled = false;
  $('delete-cancel').disabled = false;
  $('delete-keep').textContent = '保留为长期记忆并删除';
  $('delete-title').textContent = cfg.title;
  $('delete-msg').textContent = cfg.msg;
  $('delete-hint').textContent = cfg.hint;
}

// summarize=true 时先归纳长期记忆再删除；期间要调用大模型，可能耗时数秒
async function performDelete(summarize) {
  const target = state.deleteTarget;
  if (!target) return;
  const cfg = DELETE_KINDS[target.kind];

  // 归纳需要时间，禁用按钮并给出提示
  $('delete-keep').disabled = true;
  $('delete-plain').disabled = true;
  $('delete-cancel').disabled = true;
  if (summarize) {
    $('delete-keep').textContent = '正在保存记忆…';
    $('delete-hint').textContent = '正在归纳对话，请稍候…';
  }

  try {
    await api.send('DELETE', `${cfg.url(target.id)}${summarize ? '?summarize=true' : ''}`);
  } catch (err) {
    // 归纳失败时后端不会删除，提示用户可重试或直接删除
    $('delete-hint').textContent = `保存失败：${err.message}`;
    resetDeleteModalButtons();
    return;
  }

  if (target.kind === 'session') {
    if (state.activeSessionId === target.id) {
      state.activeSessionId = null;
      clearMessages(cfg.doneMsg);
      disableComposer();
    }
    closeDeleteModal();
    await loadSessions();
  } else {
    if (state.activeGroupId === target.id) {
      state.activeGroupId = null;
      state.activeMode = null;
      clearMessages(cfg.doneMsg);
      disableComposer();
      exportBtn.classList.add('hidden');
    }
    closeDeleteModal();
    await loadGroups();
  }
}

async function createSession() {
  if (!state.activePersonaId) return;
  const persona = state.personas.find((p) => p.id === state.activePersonaId);
  const session = await api.send('POST', '/api/sessions', {
    personaId: state.activePersonaId,
    title: `与${persona.name}的对话`,
  });
  await loadSessions();
  selectSession(session.id);
}

async function selectSession(id) {
  state.activeSessionId = id;
  state.activeMode = 'single';
  const persona = state.personas.find((p) => p.id === state.activePersonaId);
  chatTitle.textContent = persona ? persona.name : '会话';
  renderSessions();
  enableComposer();
  exportBtn.classList.add('hidden'); // 单聊隐藏导出按钮
  const msgs = await api.get(`/api/sessions/${id}/messages`);
  renderMessages(msgs, personaSpeaker(persona));
}

// 把人设对象转成气泡渲染用的 speaker 结构
function personaSpeaker(persona) {
  if (!persona) return { personaId: 'self', name: '', avatar: null };
  return { personaId: persona.id, name: persona.name, avatar: persona.avatar || null };
}

// [复用] 说话人唯一键：用于判断“是否换人”（换人才显示头像/名字）。无说话人返回 null。
function speakerKey(speaker) {
  return speaker ? (speaker.personaId ?? 'self') : null;
}

// ===== 群聊 =====
async function loadGroups() {
  state.groups = await api.get('/api/groups');
  renderGroups();
}

function renderGroups() {
  groupList.innerHTML = '';
  for (const g of state.groups) {
    const li = document.createElement('li');
    li.className = g.id === state.activeGroupId ? 'active' : '';
    const title = document.createElement('span');
    title.textContent = g.name;
    const del = document.createElement('span');
    del.className = 'edit';
    del.textContent = '删除';
    del.onclick = (e) => {
      e.stopPropagation();
      openDeleteModal('group', g.id);
    };
    li.append(title, del);
    li.onclick = () => selectGroup(g.id);
    groupList.appendChild(li);
  }
}

async function selectGroup(id) {
  state.activeGroupId = id;
  state.activeMode = 'group';
  // 切到群聊模式，清理单聊激活态
  state.activePersonaId = null;
  state.activeSessionId = null;
  newSessionBtn.disabled = true;
  const group = state.groups.find((g) => g.id === id);
  const memberNames = group ? group.members.map((m) => m.name).join('、') : '';
  chatTitle.textContent = group ? `${group.name}（${memberNames}）` : '群聊';
  renderPersonas();
  renderSessions();
  renderGroups();
  enableComposer();
  exportBtn.classList.remove('hidden'); // 群聊模式显示导出按钮
  const msgs = await api.get(`/api/groups/${id}/messages`);
  renderMessages(msgs);
}

// 触发当前群聊记录的下载（浏览器按后端 Content-Disposition 命名保存）
function exportCurrentGroup() {
  if (state.activeMode !== 'group' || !state.activeGroupId) return;
  const a = document.createElement('a');
  a.href = `/api/groups/${state.activeGroupId}/export`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== 已读 & 输入中 =====

// 随机延迟 ms（模拟已读延迟，300–900ms）
function randDelay(min = 300, max = 900) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 逐句发送时，两条消息之间的“正在输入”停顿：按句子长度估算，带随机抖动
function typingDelayFor(text) {
  const base = 260 + (text ? text.length : 0) * 34;
  return Math.min(1500, base) + Math.random() * 220;
}

// 在用户气泡末端添加「已读」
function addReadReceipt(wrap) {
  const span = document.createElement('span');
  span.className = 'read-receipt';
  span.textContent = '已读';
  wrap.appendChild(span);
  // 下一帧触发 transition
  requestAnimationFrame(() => requestAnimationFrame(() => span.classList.add('show')));
  return span;
}

// 显示顶部「对方正在输入…」
function showTyping(name) {
  chatStatus.innerHTML = `${name || '对方'}<span class="dots"></span>正在输入`;
  chatStatus.classList.add('visible');
}

// 清除顶部输入中状态
function hideTyping() {
  chatStatus.classList.remove('visible');
  chatStatus.innerHTML = '';
}


function clearMessages(hint) {
  hideTyping();
  messagesEl.innerHTML = `<div class="empty-hint">${hint}</div>`;
}

// defaultSpeaker：1v1 模式下所有 assistant 消息的说话人（当前人设）；群聊传 null，用每条自带的 speaker。
function renderMessages(msgs, defaultSpeaker = null) {
  messagesEl.innerHTML = '';
  if (!msgs.length) {
    clearMessages('开始对话吧');
    return;
  }
  const isGroup = !defaultSpeaker;
  // 连续同一说话人只在首条显示头像/名字，读起来更清爽
  let lastSpeakerId = null;
  for (const m of msgs) {
    const speaker = m.speaker || defaultSpeaker; // 群聊消息带 speaker，1v1 用默认
    const sid = speakerKey(speaker);
    const showHead = m.role === 'assistant' && sid !== lastSpeakerId;
    if (m.kind === 'sticker' && m.sticker) addStickerBubble(m.role, m.sticker, speaker, showHead, isGroup);
    else if (m.kind === 'file' && m.file) addFileCard(m.role, m.file, speaker, showHead, isGroup);
    else addBubble(m.role, m.content, speaker, showHead, isGroup);
    lastSpeakerId = m.role === 'assistant' ? sid : null;
  }
  scrollToBottom();
}

// 构造 assistant 消息的外层结构：[头像槽] + [气泡列]。
// speaker = { name, avatar } | null；showHead=该条是否是连续发言里的第一条（显示头像/名字）。
// withName=群聊里在气泡上方显示说话人名字。返回 { wrap, col }。
function makeAssistantShell(speaker, showHead, withName) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(makeAvatarSlot(speaker, showHead));
  const col = document.createElement('div');
  col.className = 'bubble-col';
  if (withName && showHead && speaker && speaker.name) {
    const label = document.createElement('div');
    label.className = 'speaker-name';
    label.textContent = speaker.name;
    col.appendChild(label);
  }
  wrap.appendChild(col);
  return { wrap, col };
}

// 头像圆圈：show=false 时占位隐藏（连续发言对齐用），show=true 时用 fillAvatar 填充
function makeAvatarSlot(speaker, show) {
  const el = document.createElement('div');
  el.className = 'avatar-slot' + (show ? '' : ' spacer');
  if (show && speaker) fillAvatar(el, speaker.name, speaker.avatar);
  return el;
}

// [复用] 构造一条消息的外层 wrap 与内容容器 container。
// assistant 用 [头像槽]+[气泡列] 结构（container=气泡列）；其他角色 container=wrap 本身。
function makeMessageContainer(role, speaker, showHead, withName) {
  if (role === 'assistant') {
    const shell = makeAssistantShell(speaker, showHead, withName);
    return { wrap: shell.wrap, container: shell.col };
  }
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  return { wrap, container: wrap };
}

// 一条纯文字消息 = 一个独立气泡
function addBubble(role, content, speaker, showHead = true, withName = false) {
  const { wrap, container } = makeMessageContainer(role, speaker, showHead, withName);
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content || '';
  container.appendChild(bubble);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

// 一张表情包 = 一个独立气泡（无文字背景）
function addStickerBubble(role, sticker, speaker, showHead = true, withName = false) {
  const { wrap, container } = makeMessageContainer(role, speaker, showHead, withName);
  const img = document.createElement('img');
  img.className = 'sticker';
  img.src = `stickers/${sticker.file}`;
  img.alt = sticker.id;
  img.title = sticker.id;
  img.onerror = () => { wrap.remove(); }; // 图片缺失则整条移除，不留空气泡
  container.appendChild(img);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

// 一个文件下载卡片 = 一个独立气泡（可点击下载）
function addFileCard(role, file, speaker, showHead = true, withName = false) {
  const { wrap, container } = makeMessageContainer(role, speaker, showHead, withName);
  const card = document.createElement('a');
  card.className = 'file-card';
  card.href = `/api/files/${file.id}`;
  card.setAttribute('download', file.filename || '');
  // 文档图标（纯图形 SVG）
  card.innerHTML =
    `<svg class="file-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l4 4v16a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V2z" opacity=".18"/><path d="M13 2H6a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-6-6zm0 2 4 4h-4V4z"/></svg>` +
    `<span class="file-meta"><span class="file-name"></span><span class="file-sub"></span></span>` +
    `<svg class="file-dl" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  card.querySelector('.file-name').textContent = file.filename || '文件';
  card.querySelector('.file-sub').textContent = `${(file.format || 'txt').toUpperCase()} 文件 · 点击下载`;
  container.appendChild(card);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function addToolHint(text) {
  const hint = document.createElement('div');
  hint.className = 'tool-hint';
  hint.textContent = text;
  messagesEl.appendChild(hint);
  scrollToBottom();
  return hint;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===== 发送（SSE 流式）=====
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || state.sending) return;
  if (state.activeMode === 'single' && !state.activeSessionId) return;
  if (state.activeMode === 'group' && !state.activeGroupId) return;
  if (!state.activeMode) return;

  // 首条消息时清空 hint
  if (messagesEl.querySelector('.empty-hint')) messagesEl.innerHTML = '';

  const isGroup = state.activeMode === 'group';

  state.sending = true;
  sendBtn.disabled = true;
  const userBubble = addBubble('user', text);
  inputEl.value = '';
  autoResize();

  // 1) 短暂随机延迟后显示「已读」
  await randDelay();
  addReadReceipt(userBubble.parentElement);

  // 2) 已读后再显示「对方正在输入…」并发起请求
  const defaultTypingName = isGroup ? '群成员' : chatTitle.textContent;
  showTyping(defaultTypingName);

  // 事件队列 + 消费循环：SSE 事件先入队，消费端按真人节奏一条条渲染
  const queue = [];
  let streamDone = false;
  let wake;
  const notify = () => { if (wake) { wake(); wake = null; } };
  const waitItem = () => new Promise(r => { wake = r; });

  // 1v1 模式下 assistant 消息的默认说话人（当前人设，带头像）
  const singleSpeaker = isGroup ? null : personaSpeaker(state.personas.find((p) => p.id === state.activePersonaId));
  // 连续同一说话人只在首条显示头像/名字
  let lastSpeakerId = null;

  // 消费端：逐条取出，先「正在输入」停顿，再落一个气泡
  const consumer = (async () => {
    while (true) {
      if (!queue.length) {
        if (streamDone) break;
        await waitItem();
        continue;
      }
      const item = queue.shift();
      if (item.type === 'tool') {
        const scope = item.domains?.length ? `（限 ${item.domains.join('、')}）` : '';
        addToolHint(`🔍 正在联网搜索${scope}：${item.query}`);
        continue;
      }
      const speaker = item.speaker || singleSpeaker;
      const sid = speakerKey(speaker);
      const showHead = sid !== lastSpeakerId; // 换人（或首条）时显示头像/名字
      const typingName = isGroup && speaker ? speaker.name : defaultTypingName;

      showTyping(typingName);
      await sleep(item.type === 'sticker' || item.type === 'file' ? 500 + Math.random() * 300 : typingDelayFor(item.text));
      hideTyping();
      if (item.type === 'sticker') addStickerBubble('assistant', item.sticker, speaker, showHead, isGroup);
      else if (item.type === 'file') addFileCard('assistant', item.file, speaker, showHead, isGroup);
      else addBubble('assistant', item.text, speaker, showHead, isGroup);
      lastSpeakerId = sid;
    }
  })();

  // 当前说话人（由 speaker 事件更新，附加到后续 segment/sticker）
  let currentSpeaker = null;

  try {
    const url = isGroup ? '/api/group-chat' : '/api/chat';
    const payload = isGroup
      ? { groupId: state.activeGroupId, message: text }
      : { sessionId: state.activeSessionId, message: text };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const block of events) {
        const evMatch = block.match(/^event: (.+)$/m);
        const dataMatch = block.match(/^data: (.+)$/m);
        if (!evMatch || !dataMatch) continue;
        const event = evMatch[1].trim();
        const data = JSON.parse(dataMatch[1]);

        if (event === 'speaker') {
          currentSpeaker = data; // { personaId, name }
        } else if (event === 'segment') {
          queue.push({ type: 'text', text: data.text, speaker: data.speaker || currentSpeaker });
        } else if (event === 'tool') {
          queue.push({ type: 'tool', query: data.args?.query || '', domains: data.args?.domains });
        } else if (event === 'sticker') {
          queue.push({ type: 'sticker', sticker: data, speaker: data.speaker || currentSpeaker });
        } else if (event === 'file') {
          const { speaker, ...file } = data;
          queue.push({ type: 'file', file, speaker: speaker || currentSpeaker });
        } else if (event === 'error') {
          queue.push({ type: 'text', text: `[出错] ${data.error}`, speaker: currentSpeaker });
        }
        notify();
      }
    }
  } catch (err) {
    queue.push({ type: 'text', text: `[连接失败] ${err.message}` });
    notify();
  } finally {
    streamDone = true;
    notify();
    await consumer; // 等所有气泡按节奏渲染完再解锁输入
    hideTyping();
    state.sending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ===== 输入区 =====
function enableComposer() {
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
}
function disableComposer() {
  inputEl.disabled = true;
  sendBtn.disabled = true;
}
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
}

// ===== 人设卡右侧内联编辑 =====
function openPersonaEditor(persona) {
  state.editingPersonaId = persona ? persona.id : null;
  state.editingAvatar = undefined; // 未改动
  $('persona-editor-title').textContent = persona ? '编辑人设卡' : '新建人设卡';
  const card = persona ? persona.card : {};
  $('f-name').value = card.name || '';
  $('f-persona').value = card.persona || '';
  $('f-background').value = card.background || '';
  $('f-style').value = card.speakingStyle || '';
  $('f-greeting').value = card.greeting || '';
  $('f-extra').value = card.extra || '';
  $('f-avatar-file').value = '';
  setAvatarPreview(persona ? persona.avatar : null);
  $('persona-delete').classList.toggle('hidden', !persona);
  // 显示编辑器、隐藏空提示
  $('persona-editor').classList.remove('hidden');
  $('persona-editor-empty').classList.add('hidden');
  renderPersonaManageList(); // 刷新列表高亮
  renderPersonaKbList(persona ? persona.id : null); // 加载可读资料勾选
}

function closePersonaEditor() {
  state.editingPersonaId = null;
  $('persona-editor').classList.add('hidden');
  $('persona-editor-empty').classList.remove('hidden');
  renderPersonaManageList();
}

// 在人设编辑器里渲染「可读资料」：按分类分组，组内条目复选。editing 为 null(新建)时全不选
async function renderPersonaKbList(personaId) {
  const box = $('persona-kb-list');
  box.innerHTML = '<div class="kb-auth-empty">加载中…</div>';
  try {
    const [entries, cats] = await Promise.all([
      api.get('/api/kb/entries'),      // 全部条目（含 category_name）
      api.get('/api/kb/categories'),
    ]);
    let authorized = [];
    if (personaId) {
      const r = await api.get(`/api/personas/${personaId}/kb`);
      authorized = r.entryIds || [];
    }
    box.innerHTML = '';
    if (!entries.length) {
      box.innerHTML = '<div class="kb-auth-empty">资料库还没有条目，可先去「资料库」添加。</div>';
      return;
    }
    // 按分类分组（未分类归到"未分类"）
    const byCat = new Map();
    for (const c of cats) byCat.set(c.id, { name: c.name, items: [] });
    const uncategorized = { name: '未分类', items: [] };
    for (const e of entries) {
      const g = byCat.get(e.category_id) || uncategorized;
      g.items.push(e);
    }
    const groups = [...cats.map((c) => byCat.get(c.id)), uncategorized].filter((g) => g && g.items.length);

    for (const g of groups) {
      const title = document.createElement('div');
      title.className = 'kb-auth-group-title';
      title.textContent = g.name;
      box.appendChild(title);
      for (const e of g.items) {
        const row = document.createElement('div');
        row.className = 'kb-auth-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = e.id;
        cb.id = `pkb-${e.id}`;
        cb.checked = authorized.includes(e.id);
        const label = document.createElement('label');
        label.textContent = e.title;
        label.htmlFor = `pkb-${e.id}`;
        label.style.margin = '0';
        label.style.cursor = 'pointer';
        label.style.flex = '1';
        row.append(cb, label);
        row.onclick = (ev) => { if (ev.target !== cb) cb.checked = !cb.checked; };
        box.appendChild(row);
      }
    }
  } catch {
    box.innerHTML = '<div class="kb-auth-empty">资料加载失败</div>';
  }
}

// 在弹窗里显示头像预览（src 为 data URL 或路径，空则显示占位）
function setAvatarPreview(src) {
  const el = $('avatar-preview');
  if (src) {
    el.style.backgroundImage = `url("${src}")`;
    el.classList.add('has-image');
    $('avatar-clear-btn').classList.remove('hidden');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-image');
    $('avatar-clear-btn').classList.add('hidden');
  }
}

// 读取用户选的图片，用 canvas 居中裁成正方形并缩放到 256px，返回 data URL
function resizeImageToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // 居中裁剪成正方形
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onAvatarFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageToDataUrl(file);
    state.editingAvatar = dataUrl;
    setAvatarPreview(dataUrl);
  } catch (err) {
    alert(err.message || '处理图片失败');
  }
}

function clearAvatar() {
  state.editingAvatar = null; // 显式清除
  $('f-avatar-file').value = '';
  setAvatarPreview(null);
}

async function savePersona() {
  const card = {
    name: $('f-name').value.trim(),
    persona: $('f-persona').value.trim(),
    background: $('f-background').value.trim(),
    speakingStyle: $('f-style').value.trim(),
    greeting: $('f-greeting').value.trim(),
    extra: $('f-extra').value.trim(),
  };
  if (!card.name) { alert('请填写角色名字'); return; }

  let personaId = state.editingPersonaId;
  if (personaId) {
    // editingAvatar：undefined=未改动（保留原头像）；data URL=新图；null=移除
    const existing = state.personas.find((p) => p.id === personaId);
    const avatar = state.editingAvatar === undefined ? (existing ? existing.avatar : null) : state.editingAvatar;
    await api.send('PUT', `/api/personas/${personaId}`, { card, avatar });
  } else {
    const created = await api.send('POST', '/api/personas', { card, avatar: state.editingAvatar ?? null });
    personaId = created.id;
  }

  // 保存可读资料授权（按条目全量覆盖）
  const entryIds = [...$('persona-kb-list').querySelectorAll('input[type="checkbox"]:checked')]
    .map((cb) => Number(cb.value));
  try {
    await api.send('PUT', `/api/personas/${personaId}/kb`, { entryIds });
  } catch { /* 资料库可能为空，忽略 */ }

  closePersonaEditor();
  await loadPersonas();
  await loadGroups(); // 头像变化后刷新群成员数据
}

async function deletePersonaFromModal() {
  if (!state.editingPersonaId) return;
  if (!confirm('删除该人设卡？其下所有会话与记忆也会一并删除。')) return;
  const deletedId = state.editingPersonaId;
  await api.send('DELETE', `/api/personas/${deletedId}`);
  if (state.activePersonaId === deletedId) {
    state.activePersonaId = null;
    state.activeSessionId = null;
    sessionList.innerHTML = '';
    newSessionBtn.disabled = true;
    clearMessages('左侧选择人设 → 新建会话 → 开始对话');
    disableComposer();
  }
  closePersonaEditor();
  await loadPersonas();
  await loadGroups(); // 人设删除会级联影响群成员，刷新群列表
}

// ===== 新建群聊弹窗 =====
function openGroupModal() {
  $('g-name').value = '';
  $('g-topic').value = '';
  $('g-max').value = '3';
  // 渲染人设卡多选列表
  const list = $('group-member-list');
  list.innerHTML = '';
  if (!state.personas.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有人设卡，请先在上方创建至少 2 个人设。';
    list.appendChild(li);
  } else {
    for (const p of state.personas) {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = p.id;
      cb.id = `gm-${p.id}`;
      const label = document.createElement('label');
      label.textContent = p.name;
      label.htmlFor = `gm-${p.id}`;
      label.style.margin = '0';
      label.style.cursor = 'pointer';
      label.style.flex = '1';
      li.append(cb, label);
      li.onclick = (e) => { if (e.target !== cb) cb.checked = !cb.checked; };
      list.appendChild(li);
    }
  }
  showModal('group-modal');
}

function closeGroupModal() {
  hideModal('group-modal');
}

async function createGroup() {
  const name = $('g-name').value.trim();
  if (!name) { alert('请填写群聊名称'); return; }
  const topic = $('g-topic').value.trim();
  const maxResponses = Math.max(1, Math.min(10, Number($('g-max').value) || 3));
  const memberIds = [...$('group-member-list').querySelectorAll('input[type="checkbox"]:checked')]
    .map((cb) => Number(cb.value));
  if (memberIds.length < 2) { alert('群聊至少选择 2 个人设'); return; }

  const group = await api.send('POST', '/api/groups', { name, topic, maxResponses, memberIds });
  closeGroupModal();
  await loadGroups();
  selectGroup(group.id);
}

// ===== 资料库 =====
// 分类只做增删；条目列表展示全部条目（标注所属分类），新建条目不必先选分类。
async function loadCategories() {
  state.categories = await api.get('/api/kb/categories');
  renderCategories();
  await loadEntries();
}

function renderCategories() {
  const list = $('category-list');
  list.innerHTML = '';
  if (!state.categories.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '点右上 ＋ 新建分类';
    list.appendChild(li);
    return;
  }
  for (const c of state.categories) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = c.name;
    name.style.flex = '1';
    const del = document.createElement('span');
    del.className = 'edit';
    del.textContent = '删除';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除分类「${c.name}」？其下所有条目会一并删除。`)) return;
      await api.send('DELETE', `/api/kb/categories/${c.id}`);
      if (state.activeEntryId) { state.activeEntryId = null; showEntryEditor(false); }
      await loadCategories();
    };
    li.append(name, del);
    list.appendChild(li);
  }
}

// 加载全部条目（含所属分类名）
async function loadEntries() {
  state.entries = await api.get('/api/kb/entries');
  renderEntries();
}

function renderEntries() {
  const list = $('entry-list');
  list.innerHTML = '';
  if (!state.entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '点右上 ＋ 新建条目';
    list.appendChild(li);
    return;
  }
  for (const e of state.entries) {
    const li = document.createElement('li');
    li.className = e.id === state.activeEntryId ? 'active' : '';
    const title = document.createElement('span');
    title.textContent = e.title;
    title.style.flex = '1';
    // 分类标签
    if (e.category_name) {
      const tag = document.createElement('span');
      tag.className = 'entry-cat-tag';
      tag.textContent = e.category_name;
      title.append(' ');
      li.append(title, tag);
    } else {
      li.append(title);
    }
    const del = document.createElement('span');
    del.className = 'edit';
    del.textContent = '删除';
    del.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(`删除条目「${e.title}」？`)) return;
      await api.send('DELETE', `/api/kb/entries/${e.id}`);
      if (state.activeEntryId === e.id) { state.activeEntryId = null; showEntryEditor(false); }
      await loadEntries();
    };
    li.append(del);
    li.onclick = () => selectEntry(e.id);
    list.appendChild(li);
  }
}

// 填充条目编辑器里的分类下拉
function fillCategorySelect(selectedId) {
  const sel = $('entry-category');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（未分类）';
  sel.appendChild(none);
  for (const c of state.categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

function selectEntry(id) {
  state.activeEntryId = id;
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  $('entry-title').value = entry.title;
  $('entry-content').value = entry.content || '';
  fillCategorySelect(entry.category_id);
  renderEntries();
  showEntryEditor(true);
}

function showEntryEditor(show) {
  $('entry-editor').classList.toggle('hidden', !show);
  $('entry-empty').classList.toggle('hidden', show);
}

async function createCategory() {
  const name = (prompt('分类名称：') || '').trim();
  if (!name) return;
  await api.send('POST', '/api/kb/categories', { name });
  await loadCategories();
}

async function createEntry() {
  // 默认落到第一个分类（若有），否则未分类
  const categoryId = state.categories[0] ? state.categories[0].id : null;
  if (!categoryId) {
    alert('请先新建至少一个分类');
    return;
  }
  const entry = await api.send('POST', '/api/kb/entries', {
    categoryId,
    title: '新条目',
    content: '',
  });
  await loadEntries();
  selectEntry(entry.id);
  $('entry-title').focus();
  $('entry-title').select();
}

async function saveEntry() {
  if (!state.activeEntryId) return;
  const title = $('entry-title').value.trim();
  if (!title) { alert('请填写条目标题'); return; }
  const categoryId = $('entry-category').value ? Number($('entry-category').value) : null;
  await api.send('PUT', `/api/kb/entries/${state.activeEntryId}`, {
    title,
    content: $('entry-content').value,
    categoryId,
  });
  await loadEntries();
  selectEntry(state.activeEntryId);
  flashEntrySaved();
}

// ===== 设置 =====
async function loadSettings() {
  try {
    const s = await api.get('/api/settings');
    $('s-baseurl').value = s.baseUrl || '';
    $('s-model').value = s.model || '';
    $('s-apikey').value = '';
    $('s-apikey-hint').textContent = s.apiKeySet ? '当前状态：已配置（留空则不修改）' : '当前状态：未配置';
  } catch { /* 忽略 */ }
}

async function saveSettings() {
  const body = {
    baseUrl: $('s-baseurl').value.trim(),
    model: $('s-model').value.trim(),
  };
  const key = $('s-apikey').value.trim();
  if (key) body.apiKey = key;

  const msg = $('s-msg');
  try {
    const s = await api.send('PUT', '/api/settings', body);
    msg.textContent = '已保存并生效';
    msg.className = 'settings-msg ok';
    $('s-apikey').value = '';
    $('s-apikey-hint').textContent = s.apiKeySet ? '当前状态：已配置（留空则不修改）' : '当前状态：未配置';
  } catch (err) {
    msg.textContent = `保存失败：${err.message}`;
    msg.className = 'settings-msg err';
  }
  setTimeout(() => { if (msg.classList.contains('ok')) { msg.textContent = ''; msg.className = 'settings-msg'; } }, 3000);
}

// 条目保存后的轻提示（借用 entry-save 按钮文字反馈）
function flashEntrySaved() {
  const btn = $('entry-save');
  const orig = btn.textContent;
  btn.textContent = '已保存';
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ===== 事件绑定 =====
function bindEvents() {
  // 顶层导航
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.onclick = () => switchView(b.dataset.view);
  });

  $('new-persona-btn').onclick = () => openPersonaEditor(null);
  $('new-session-btn').onclick = createSession;

  // 资料库
  $('new-category-btn').onclick = createCategory;
  $('new-entry-btn').onclick = createEntry;
  $('entry-save').onclick = saveEntry;

  // 设置
  $('s-save').onclick = saveSettings;

  // 人设卡编辑（右侧内联）
  $('persona-save').onclick = savePersona;
  $('persona-delete').onclick = deletePersonaFromModal;
  // 头像上传
  $('avatar-upload-btn').onclick = () => $('f-avatar-file').click();
  $('f-avatar-file').addEventListener('change', onAvatarFileChosen);
  $('avatar-clear-btn').onclick = clearAvatar;

  // 新建群聊弹窗
  $('new-group-btn').onclick = openGroupModal;
  $('group-close').onclick = closeGroupModal;
  $('group-create').onclick = createGroup;
  bindModalBackdrop('group-modal', closeGroupModal);

  // 删除会话弹窗
  $('delete-keep').onclick = () => performDelete(true);
  $('delete-plain').onclick = () => performDelete(false);
  $('delete-cancel').onclick = closeDeleteModal;
  $('delete-close').onclick = closeDeleteModal;
  bindModalBackdrop('delete-modal', closeDeleteModal);

  exportBtn.onclick = exportCurrentGroup;

  sendBtn.onclick = sendMessage;
  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

init();
