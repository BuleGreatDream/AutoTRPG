import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config, features } from './src/config.js';
import { sessions, messages, groups, groupMessages, kbCategories, kbEntries, personaKb, groupKb } from './src/db.js';
import { updateEnvFile } from './src/env-file.js';
import { getTempFile } from './src/files.js';
import {
  listPersonas,
  getPersona,
  createPersona,
  updatePersona,
  deletePersona,
  greetingOf,
} from './src/persona.js';
import { personas as personasDao } from './src/db.js';
import { handleUserMessage } from './src/chat.js';
import { handleGroupMessage } from './src/groupchat.js';
import { hasStickers, stickerCount, stickerCatalog, getSticker } from './src/stickers.js';
import { summarizeSession, summarizeGroup } from './src/memory.js';
import { runSSE } from './src/sse.js';
import { contentView, publicMember, publicSpeaker, groupTranscriptMarkdown } from './src/serialize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 开发模式判定：npm run dev:server 带了 --watch，npm start 不带。
// 开发时跳过 dist 静态托管——前端由 Vite dev server（5173）提供，3001 只做 API。
const isDev = process.argv.includes('--watch') || process.execArgv.includes('--watch');

const app = express();
app.use(express.json({ limit: '1mb' }));
// 静态资源：
// 生产模式（npm start）：dist 构建产物由 Express 单端口交付
// 开发模式（npm run dev:server）：跳过 dist，前端由 Vite dev server（5173）提供
if (!isDev) {
  app.use(express.static(join(__dirname, 'dist')));
}
app.use('/stickers', express.static(join(__dirname, 'public', 'stickers')));

// 包装异步路由的错误处理
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

// ===== 能力查询 =====
app.get('/api/features', (req, res) => {
  res.json({
    webSearch: features.webSearch,
    longTermMemory: features.longTermMemory,
    stickers: hasStickers,
    groupChat: true,
  });
});

// 表情包目录：供前端表情选择器渲染（id/file/emotion）
app.get('/api/stickers', (req, res) => {
  res.json(stickerCatalog());
});

// ===== 人设卡 =====
app.get('/api/personas', wrap((req, res) => {
  res.json(listPersonas());
}));

app.post('/api/personas', wrap((req, res) => {
  const { card, avatar } = req.body || {};
  if (!card || !card.name) return res.status(400).json({ error: '缺少人设卡名字' });
  res.json(createPersona(card, avatar));
}));

app.put('/api/personas/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!getPersona(id)) return res.status(404).json({ error: '人设不存在' });
  const { card, avatar } = req.body || {};
  if (!card || !card.name) return res.status(400).json({ error: '缺少人设卡名字' });
  res.json(updatePersona(id, card, avatar));
}));

app.delete('/api/personas/:id', wrap((req, res) => {
  deletePersona(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== 会话 =====
app.get('/api/sessions', wrap((req, res) => {
  const personaId = Number(req.query.personaId);
  if (!personaId) return res.status(400).json({ error: '缺少 personaId' });
  res.json(sessions.listByPersona(personaId));
}));

app.post('/api/sessions', wrap((req, res) => {
  const { personaId, title } = req.body || {};
  const persona = personasDao.get(Number(personaId));
  if (!persona) return res.status(404).json({ error: '人设不存在' });
  const session = sessions.create({ personaId: persona.id, title });

  // 若人设有开场白，作为第一条 assistant 消息落库
  const greeting = greetingOf(persona);
  if (greeting) {
    messages.add({ sessionId: session.id, role: 'assistant', content: greeting });
  }
  res.json(session);
}));

app.delete('/api/sessions/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!sessions.get(id)) return res.status(404).json({ error: '会话不存在' });

  // summarize=true 时，先把整段会话归纳进人设长期记忆，再删除
  const wantSummarize = String(req.query.summarize) === 'true';
  let summarized = false;
  if (wantSummarize) {
    try {
      summarized = await summarizeSession(id);
    } catch (err) {
      console.error('[delete-session] 归纳长期记忆失败：', err.message);
      return res.status(500).json({ error: `保存长期记忆失败：${err.message}` });
    }
  }

  sessions.remove(id);
  res.json({ ok: true, summarized });
}));

app.get('/api/sessions/:id/messages', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!sessions.get(id)) return res.status(404).json({ error: '会话不存在' });
  // 把表情包标记消息转成前端可直接渲染的结构
  const list = messages.listBySession(id).map((m) => ({ ...m, ...contentView(m.content) }));
  res.json(list);
}));

// ===== 群聊 =====
app.get('/api/groups', wrap((req, res) => {
  const list = groups.list().map((g) => ({
    ...g,
    members: groups.members(g.id).map(publicMember),
  }));
  res.json(list);
}));

app.post('/api/groups', wrap((req, res) => {
  const { name, topic, maxResponses, memberIds, kbEntryIds } = req.body || {};
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds.map(Number).filter(Boolean))] : [];
  if (ids.length < 2) return res.status(400).json({ error: '群聊至少需要选择 2 个人设' });
  // 校验成员都存在
  for (const id of ids) {
    if (!personasDao.get(id)) return res.status(400).json({ error: `人设 ${id} 不存在` });
  }
  const max = Math.max(1, Math.min(10, Number(maxResponses) || 3)); // 上限约束在 1..10
  const group = groups.create({
    name: (name || '新群聊').trim() || '新群聊',
    topic: (topic || '').trim(),
    maxResponses: max,
    memberIds: ids,
  });
  // 可选：建群同时设置群聊资料授权（只保留真实存在的条目）
  if (Array.isArray(kbEntryIds) && kbEntryIds.length) {
    const validKb = [...new Set(kbEntryIds.map(Number).filter(Boolean))].filter((eid) => kbEntries.get(eid));
    if (validKb.length) groupKb.setFor(group.id, validKb);
  }
  res.json({ ...group, members: groups.members(group.id).map(publicMember) });
}));

app.delete('/api/groups/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!groups.get(id)) return res.status(404).json({ error: '群组不存在' });

  // summarize=true 时，先把整段群聊分别归纳进每个成员的长期记忆，再删除
  const wantSummarize = String(req.query.summarize) === 'true';
  let summarizedCount = 0;
  if (wantSummarize) {
    try {
      summarizedCount = await summarizeGroup(id);
    } catch (err) {
      console.error('[delete-group] 归纳群聊记忆失败：', err.message);
      return res.status(500).json({ error: `保存长期记忆失败：${err.message}` });
    }
  }

  groups.remove(id);
  res.json({ ok: true, summarizedCount });
}));

app.get('/api/groups/:id/messages', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!groups.get(id)) return res.status(404).json({ error: '群组不存在' });
  const list = groupMessages.listByGroup(id).map((m) => {
    const view = contentView(m.content);
    const base = { id: m.id, role: m.role, speaker: publicSpeaker(m) };
    // 文本消息带上 content；表情包消息用 view.sticker，不需要原始标记
    return view.kind === 'sticker' ? { ...base, ...view } : { ...base, ...view, content: m.content };
  });
  res.json(list);
}));

// 导出群聊记录为 Markdown 附件下载
app.get('/api/groups/:id/export', wrap((req, res) => {
  const id = Number(req.params.id);
  const group = groups.get(id);
  if (!group) return res.status(404).json({ error: '群组不存在' });

  const md = groupTranscriptMarkdown(group, groups.members(id), groupMessages.listByGroup(id), Date.now());
  // 文件名用 URL 编码，避免中文群名在部分浏览器下乱码
  const filename = `${group.name}-聊天记录.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="chat.md"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(md);
}));

app.post('/api/group-chat', wrap(async (req, res) => {
  const { groupId, message, stickerId } = req.body || {};
  // 允许两种发言：纯文本，或一个表情包（stickerId）
  if (stickerId && !getSticker(stickerId)) {
    return res.status(400).json({ error: '表情包不存在' });
  }
  if (!groupId || (!stickerId && (!message || !message.trim()))) {
    return res.status(400).json({ error: '缺少 groupId 或 message/stickerId' });
  }
  if (!groups.get(Number(groupId))) {
    return res.status(404).json({ error: '群组不存在' });
  }

  await runSSE(res, (send) =>
    handleGroupMessage(Number(groupId), message?.trim() || '', {
      stickerId: stickerId || null,
      onSpeakerStart: (speaker) => send('speaker', speaker),
      onSegment: (text, speaker) => send('segment', { text, speaker }),
      onSticker: (sticker, speaker) =>
        send('sticker', { id: sticker.id, file: sticker.file, speaker }),
      onFile: (meta, speaker) => send('file', { ...meta, speaker }),
      onToolCall: (name, args) => send('tool', { name, args }),
    })
  );
}));

// ===== 聊天（SSE 流式）=====
app.post('/api/chat', wrap(async (req, res) => {
  const { sessionId, message, stickerId } = req.body || {};
  // 允许两种发言：纯文本，或一个表情包（stickerId）
  if (stickerId && !getSticker(stickerId)) {
    return res.status(400).json({ error: '表情包不存在' });
  }
  if (!sessionId || (!stickerId && (!message || !message.trim()))) {
    return res.status(400).json({ error: '缺少 sessionId 或 message/stickerId' });
  }
  if (!sessions.get(Number(sessionId))) {
    return res.status(404).json({ error: '会话不存在' });
  }

  await runSSE(res, (send) =>
    handleUserMessage(Number(sessionId), message?.trim() || '', {
      stickerId: stickerId || null,
      onSegment: (text) => send('segment', { text }),
      onToolCall: (name, args) => send('tool', { name, args }),
      onSticker: (sticker) => send('sticker', { id: sticker.id, file: sticker.file }),
      onFile: (meta) => send('file', meta),
    })
  );
}));

// ===== 资料库：分类 =====
app.get('/api/kb/categories', wrap((req, res) => {
  res.json(kbCategories.list());
}));

app.post('/api/kb/categories', wrap((req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '缺少分类名称' });
  res.json(kbCategories.create({ name }));
}));

app.delete('/api/kb/categories/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!kbCategories.get(id)) return res.status(404).json({ error: '分类不存在' });
  kbCategories.remove(id); // 级联删除其下条目与授权
  res.json({ ok: true });
}));

// ===== 资料库：条目 =====
app.get('/api/kb/entries', wrap((req, res) => {
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  res.json(categoryId ? kbEntries.listByCategory(categoryId) : kbEntries.listAll());
}));

app.post('/api/kb/entries', wrap((req, res) => {
  const { categoryId, title, content } = req.body || {};
  if (!categoryId || !kbCategories.get(Number(categoryId))) {
    return res.status(400).json({ error: '分类不存在' });
  }
  if (!(title || '').trim()) return res.status(400).json({ error: '缺少条目标题' });
  res.json(kbEntries.create({ categoryId: Number(categoryId), title: title.trim(), content: content || '' }));
}));

app.put('/api/kb/entries/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!kbEntries.get(id)) return res.status(404).json({ error: '条目不存在' });
  const { title, content, categoryId } = req.body || {};
  if (!(title || '').trim()) return res.status(400).json({ error: '缺少条目标题' });
  // categoryId 可选；给了就校验存在
  let cid = null;
  if (categoryId != null) {
    cid = Number(categoryId);
    if (!kbCategories.get(cid)) return res.status(400).json({ error: '分类不存在' });
  }
  res.json(kbEntries.update(id, { title: title.trim(), content: content || '', categoryId: cid }));
}));

app.delete('/api/kb/entries/:id', wrap((req, res) => {
  kbEntries.remove(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== 人设→资料授权 =====
app.get('/api/personas/:id/kb', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!getPersona(id)) return res.status(404).json({ error: '人设不存在' });
  res.json({ entryIds: personaKb.entryIdsFor(id) });
}));

app.put('/api/personas/:id/kb', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!getPersona(id)) return res.status(404).json({ error: '人设不存在' });
  const ids = Array.isArray(req.body?.entryIds)
    ? [...new Set(req.body.entryIds.map(Number).filter(Boolean))]
    : [];
  // 只保留真实存在的条目 id
  const valid = ids.filter((eid) => kbEntries.get(eid));
  personaKb.setFor(id, valid);
  res.json({ ok: true, entryIds: valid });
}));

// ===== 群聊→资料授权（与人设授权并列，检索时并集）=====
app.get('/api/groups/:id/kb', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!groups.get(id)) return res.status(404).json({ error: '群组不存在' });
  res.json({ entryIds: groupKb.entryIdsFor(id) });
}));

app.put('/api/groups/:id/kb', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!groups.get(id)) return res.status(404).json({ error: '群组不存在' });
  const ids = Array.isArray(req.body?.entryIds)
    ? [...new Set(req.body.entryIds.map(Number).filter(Boolean))]
    : [];
  const valid = ids.filter((eid) => kbEntries.get(eid));
  groupKb.setFor(id, valid);
  res.json({ ok: true, entryIds: valid });
}));

// ===== 设置：大模型配置 =====
app.get('/api/settings', (req, res) => {
  // 不回传密钥明文，只报是否已配置
  res.json({
    baseUrl: config.chat.baseUrl,
    model: config.chat.model,
    apiKeySet: Boolean(config.chat.apiKey),
  });
});

app.put('/api/settings', wrap((req, res) => {
  const { baseUrl, model, apiKey } = req.body || {};
  const updates = {};

  if (typeof baseUrl === 'string') {
    const v = baseUrl.trim().replace(/\/$/, '');
    config.chat.baseUrl = v;
    updates.OPENAI_BASE_URL = v;
  }
  if (typeof model === 'string' && model.trim()) {
    config.chat.model = model.trim();
    updates.CHAT_MODEL = model.trim();
  }
  // apiKey 仅在传入非空时更新（空字符串视为“不改动”，避免误清空）
  if (typeof apiKey === 'string' && apiKey.trim()) {
    config.chat.apiKey = apiKey.trim();
    updates.OPENAI_API_KEY = apiKey.trim();
  }

  if (Object.keys(updates).length) {
    try {
      updateEnvFile(updates); // 写回 .env 持久化
    } catch (err) {
      console.error('[settings] 写回 .env 失败：', err.message);
      return res.status(500).json({ error: `写入配置文件失败：${err.message}` });
    }
  }

  res.json({ baseUrl: config.chat.baseUrl, model: config.chat.model, apiKeySet: Boolean(config.chat.apiKey) });
}));

// ===== 临时文件下载 =====
app.get('/api/files/:id', wrap((req, res) => {
  const meta = getTempFile(req.params.id);
  if (!meta) return res.status(404).json({ error: '文件不存在或已过期' });
  res.setHeader('Content-Type', meta.mime);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="file.${meta.format}"; filename*=UTF-8''${encodeURIComponent(meta.filename)}`
  );
  res.sendFile(meta.path);
}));

app.listen(config.server.port, config.server.host, () => {
  console.log(`\n  AI 人格化聊天室已启动：http://${config.server.host}:${config.server.port}`);
  console.log(`  联网搜索：${features.webSearch ? '开启 (Tavily)' : '关闭（未配置 TAVILY_API_KEY）'}`);
  console.log(`  长期记忆：${features.longTermMemory ? '开启（摘要式）' : '关闭'}`);
  console.log(`  表情包：${hasStickers ? `开启（${stickerCount} 个）` : '关闭（stickers.json 为空）'}\n`);
});
