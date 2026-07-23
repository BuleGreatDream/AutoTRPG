import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'chat.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    card_json  TEXT NOT NULL,
    avatar     TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id     INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    summarized_upto INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- 摘要式长期记忆：每个人设一条滚动摘要
  CREATE TABLE IF NOT EXISTS memories (
    persona_id INTEGER PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    summary    TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  -- 群聊：一个群组编排多个人设
  CREATE TABLE IF NOT EXISTS groups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    topic         TEXT,
    max_responses INTEGER NOT NULL DEFAULT 3,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, persona_id)
  );
  -- 群聊消息：独立于 1v1 的 messages 表。
  -- speaker_persona_id 记录该 assistant 消息由哪个成员所说；user 消息为 NULL。
  CREATE TABLE IF NOT EXISTS group_messages (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id           INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    role               TEXT NOT NULL,
    speaker_persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
    content            TEXT NOT NULL,
    created_at         INTEGER NOT NULL
  );

  -- 资料库：分类 → 条目；人设按条目授权可读
  CREATE TABLE IF NOT EXISTS kb_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kb_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES kb_categories(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS persona_kb (
    persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    entry_id   INTEGER NOT NULL REFERENCES kb_entries(id) ON DELETE CASCADE,
    PRIMARY KEY (persona_id, entry_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
  CREATE INDEX IF NOT EXISTS idx_kb_entries_category ON kb_entries(category_id);
  CREATE INDEX IF NOT EXISTS idx_persona_kb_persona ON persona_kb(persona_id);
`);

// 兼容旧库：groups 表若无 topic 列则补上（幂等，已存在会抛错，忽略即可）
try {
  db.exec('ALTER TABLE groups ADD COLUMN topic TEXT');
} catch {
  // 列已存在，忽略
}

const now = () => Date.now();

// ===== 人设卡 =====
export const personas = {
  list() {
    return db.prepare('SELECT * FROM personas ORDER BY created_at DESC').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
  },
  create({ name, cardJson, avatar }) {
    const info = db
      .prepare('INSERT INTO personas (name, card_json, avatar, created_at) VALUES (?, ?, ?, ?)')
      .run(name, cardJson, avatar || null, now());
    return this.get(info.lastInsertRowid);
  },
  update(id, { name, cardJson, avatar }) {
    db.prepare('UPDATE personas SET name = ?, card_json = ?, avatar = ? WHERE id = ?')
      .run(name, cardJson, avatar || null, id);
    return this.get(id);
  },
  remove(id) {
    db.prepare('DELETE FROM personas WHERE id = ?').run(id);
  },
};

// ===== 会话 =====
export const sessions = {
  listByPersona(personaId) {
    return db
      .prepare('SELECT * FROM sessions WHERE persona_id = ? ORDER BY created_at DESC')
      .all(personaId);
  },
  get(id) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  },
  create({ personaId, title }) {
    const info = db
      .prepare('INSERT INTO sessions (persona_id, title, created_at) VALUES (?, ?, ?)')
      .run(personaId, title || '新会话', now());
    return this.get(info.lastInsertRowid);
  },
  rename(id, title) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id);
    return this.get(id);
  },
  setSummarizedUpto(id, messageId) {
    db.prepare('UPDATE sessions SET summarized_upto = ? WHERE id = ?').run(messageId, id);
  },
  remove(id) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
};

// ===== 消息 =====
export const messages = {
  listBySession(sessionId) {
    return db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId);
  },
  // 最近 N 条（按时间正序返回，便于直接拼上下文）
  recent(sessionId, limit) {
    const rows = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit);
    return rows.reverse();
  },
  add({ sessionId, role, content }) {
    const info = db
      .prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, now());
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  },
  // 取 id 落在 (afterId, maxId] 区间的消息，按时间正序 —— 用于把滑出短期窗口的旧消息归纳进摘要
  between(sessionId, afterId, maxId) {
    return db
      .prepare(
        'SELECT * FROM messages WHERE session_id = ? AND id > ? AND id <= ? ORDER BY id ASC'
      )
      .all(sessionId, afterId, maxId);
  },
};

// ===== 长期记忆（摘要式）=====
export const memories = {
  // 读取某人设的滚动摘要文本（无则空串）
  getSummary(personaId) {
    const row = db.prepare('SELECT summary FROM memories WHERE persona_id = ?').get(personaId);
    return row ? row.summary : '';
  },
  // upsert 摘要
  setSummary(personaId, summary) {
    db.prepare(
      `INSERT INTO memories (persona_id, summary, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(persona_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`
    ).run(personaId, summary, now());
  },
};

// ===== 群聊 =====
export const groups = {
  list() {
    return db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  },
  // 插入群组 + 成员关系（node:sqlite 无 db.transaction，手动 BEGIN/COMMIT 保证原子性）
  create({ name, topic, maxResponses, memberIds }) {
    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO group_members (group_id, persona_id) VALUES (?, ?)'
    );
    db.exec('BEGIN');
    try {
      const info = db
        .prepare('INSERT INTO groups (name, topic, max_responses, created_at) VALUES (?, ?, ?, ?)')
        .run(name, topic || null, maxResponses, now());
      const gid = info.lastInsertRowid;
      for (const pid of memberIds) insertMember.run(gid, pid);
      db.exec('COMMIT');
      return this.get(gid);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
  remove(id) {
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  },
  // 群成员（join 出人设卡，按 persona id 升序稳定排序）
  members(groupId) {
    return db
      .prepare(
        `SELECT p.* FROM group_members gm
         JOIN personas p ON p.id = gm.persona_id
         WHERE gm.group_id = ? ORDER BY p.id ASC`
      )
      .all(groupId);
  },
};

// ===== 群聊消息 =====
export const groupMessages = {
  // 全部消息，join 出说话人名字，按时间正序
  listByGroup(groupId) {
    return db
      .prepare(
        `SELECT gm.*, p.name AS speaker_name, p.avatar AS speaker_avatar FROM group_messages gm
         LEFT JOIN personas p ON p.id = gm.speaker_persona_id
         WHERE gm.group_id = ? ORDER BY gm.id ASC`
      )
      .all(groupId);
  },
  // 最近 N 条（按时间正序返回，便于直接拼上下文）
  recentByGroup(groupId, limit) {
    const rows = db
      .prepare(
        `SELECT gm.*, p.name AS speaker_name FROM group_messages gm
         LEFT JOIN personas p ON p.id = gm.speaker_persona_id
         WHERE gm.group_id = ? ORDER BY gm.id DESC LIMIT ?`
      )
      .all(groupId, limit);
    return rows.reverse();
  },
  add({ groupId, role, content, speakerPersonaId }) {
    const info = db
      .prepare(
        'INSERT INTO group_messages (group_id, role, speaker_persona_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(groupId, role, speakerPersonaId ?? null, content, now());
    return db.prepare('SELECT * FROM group_messages WHERE id = ?').get(info.lastInsertRowid);
  },
};

// ===== 资料库：分类 =====
export const kbCategories = {
  list() {
    return db.prepare('SELECT * FROM kb_categories ORDER BY created_at ASC').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id);
  },
  create({ name }) {
    const info = db
      .prepare('INSERT INTO kb_categories (name, created_at) VALUES (?, ?)')
      .run(name, now());
    return this.get(info.lastInsertRowid);
  },
  remove(id) {
    db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);
  },
};

// ===== 资料库：条目 =====
export const kbEntries = {
  listByCategory(categoryId) {
    return db
      .prepare('SELECT * FROM kb_entries WHERE category_id = ? ORDER BY id ASC')
      .all(categoryId);
  },
  listAll() {
    return db
      .prepare(
        `SELECT e.*, c.name AS category_name FROM kb_entries e
         LEFT JOIN kb_categories c ON c.id = e.category_id
         ORDER BY e.category_id ASC, e.id ASC`
      )
      .all();
  },
  get(id) {
    return db.prepare('SELECT * FROM kb_entries WHERE id = ?').get(id);
  },
  create({ categoryId, title, content }) {
    const info = db
      .prepare('INSERT INTO kb_entries (category_id, title, content, created_at) VALUES (?, ?, ?, ?)')
      .run(categoryId, title, content || '', now());
    return this.get(info.lastInsertRowid);
  },
  update(id, { title, content, categoryId }) {
    if (categoryId != null) {
      db.prepare('UPDATE kb_entries SET title = ?, content = ?, category_id = ? WHERE id = ?')
        .run(title, content || '', categoryId, id);
    } else {
      db.prepare('UPDATE kb_entries SET title = ?, content = ? WHERE id = ?')
        .run(title, content || '', id);
    }
    return this.get(id);
  },
  remove(id) {
    db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id);
  },
};

// ===== 资料库：人设→条目授权 =====
export const personaKb = {
  // 该人设已授权的条目 id 列表
  entryIdsFor(personaId) {
    return db
      .prepare('SELECT entry_id FROM persona_kb WHERE persona_id = ?')
      .all(personaId)
      .map((r) => r.entry_id);
  },
  // 全量覆盖授权（先清空再插入，手动事务保证原子性）
  setFor(personaId, entryIds) {
    const ins = db.prepare('INSERT OR IGNORE INTO persona_kb (persona_id, entry_id) VALUES (?, ?)');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM persona_kb WHERE persona_id = ?').run(personaId);
      for (const eid of entryIds) ins.run(personaId, eid);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
  // 该人设可读的条目（join 出标题/正文/分类），按分类+id 排序
  listEntriesFor(personaId) {
    return db
      .prepare(
        `SELECT e.*, c.name AS category_name FROM persona_kb pk
         JOIN kb_entries e ON e.id = pk.entry_id
         LEFT JOIN kb_categories c ON c.id = e.category_id
         WHERE pk.persona_id = ? ORDER BY e.category_id ASC, e.id ASC`
      )
      .all(personaId);
  },
};

export default db;
