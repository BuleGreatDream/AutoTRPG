import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, '..', 'data', 'tmp');
mkdirSync(tmpDir, { recursive: true });

// 临时文件存活时长：2 小时（下载链接过期即清理）
const TTL_MS = 2 * 60 * 60 * 1000;

// 只支持这两种文本格式
const FORMATS = {
  txt: { ext: 'txt', mime: 'text/plain; charset=utf-8' },
  md: { ext: 'md', mime: 'text/markdown; charset=utf-8' },
};

// 内存索引：id -> { id, filename, format, mime, path, createdAt }
const index = new Map();

// 清洗用户/模型给的文件名：去路径分隔符与危险字符，限长
function sanitizeName(name, ext) {
  let base = String(name || '').trim().replace(/\.(txt|md)$/i, '');
  base = base.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  if (!base) base = '文件';
  if (base.length > 80) base = base.slice(0, 80);
  return `${base}.${ext}`;
}

// 删除过期文件（惰性调用：每次创建/读取时顺带清理）
function sweep() {
  const now = nowMs();
  for (const [id, meta] of index) {
    if (now - meta.createdAt > TTL_MS) {
      try { rmSync(meta.path, { force: true }); } catch { /* 忽略 */ }
      index.delete(id);
    }
  }
}

// 可注入的当前时间（Date.now 在普通运行时可用；集中一处便于测试）
function nowMs() {
  return Date.now();
}

/**
 * 生成一个临时文件，返回其元数据。
 * @param {object} opts
 * @param {string} opts.filename 期望文件名（可不带扩展名）
 * @param {string} opts.content 文件文本内容
 * @param {string} opts.format 'txt' | 'md'
 * @returns {{id:string, filename:string, format:string}}
 */
export function createTempFile({ filename, content, format }) {
  sweep();
  const fmt = FORMATS[String(format || '').toLowerCase()] || FORMATS.txt;
  const name = sanitizeName(filename, fmt.ext);
  const id = randomUUID();
  const path = join(tmpDir, `${id}.${fmt.ext}`);
  writeFileSync(path, String(content ?? ''), 'utf-8');
  const meta = { id, filename: name, format: fmt.ext, mime: fmt.mime, path, createdAt: nowMs() };
  index.set(id, meta);
  return { id, filename: name, format: fmt.ext };
}

/**
 * 按 id 取临时文件元数据（含磁盘路径）；不存在或已过期返回 null。
 */
export function getTempFile(id) {
  sweep();
  const meta = index.get(id);
  if (!meta) return null;
  if (!existsSync(meta.path)) { index.delete(id); return null; }
  return meta;
}

// 文件作为独立消息落库时的内容标记：\x01FILE:{json}
const FILE_PREFIX = '\x01FILE:';

/** 把文件元数据编码成可落库的消息内容。 */
export function fileContent(meta) {
  return FILE_PREFIX + JSON.stringify({ id: meta.id, filename: meta.filename, format: meta.format });
}

/** 若消息内容是文件标记则返回 {id,filename,format}，否则返回 null。 */
export function parseFileContent(content) {
  if (typeof content !== 'string' || !content.startsWith(FILE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(FILE_PREFIX.length));
  } catch {
    return null;
  }
}

// 启动时清理一次遗留的孤儿临时文件（上次运行残留、且不在索引里）
try {
  for (const f of readdirSync(tmpDir)) {
    const p = join(tmpDir, f);
    try {
      if (nowMs() - statSync(p).mtimeMs > TTL_MS) rmSync(p, { force: true });
    } catch { /* 忽略 */ }
  }
} catch { /* 忽略 */ }
