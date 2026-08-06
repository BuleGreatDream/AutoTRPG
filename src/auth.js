// 登录鉴权的底层工具：密码哈希、令牌、cookie 读写、失败限流。
//
// 不引任何依赖：scrypt / randomBytes 来自 node:crypto，cookie 手写解析。
// 会话令牌本身存在库里（auth_sessions 表，见 db.js），这里只管生成与校验。
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const COOKIE_NAME = 'auth_token';

// 登录有效期 30 天（cookie 与库里的 expires_at 用同一个值）
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 生成 `salt:hash` 形式的密码哈希（scrypt，salt 随机 16 字节）。 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

/** 校验密码。用 timingSafeEqual 逐字节等时比对，避免按前缀提前返回泄漏信息。 */
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** 新的会话令牌（32 字节随机，hex 64 字符）。 */
export function newToken() {
  return randomBytes(32).toString('hex');
}

/**
 * 校验账号密码格式。
 * @returns {string|null} 错误信息；null 表示合法
 */
export function validateCredentials(username, password) {
  const u = String(username || '').trim();
  if (u.length < 3 || u.length > 32) return '账号需 3-32 个字符';
  if (!/^[\w一-龥.@-]+$/.test(u)) return '账号只能包含字母、数字、下划线、中文以及 . @ -';
  if (String(password || '').length < 6) return '密码至少 6 位';
  return null;
}

// ===== Cookie =====

/** 解析 Cookie 请求头成对象（只做这一个用途，不求通用）。 */
export function parseCookie(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 从请求里取登录令牌。 */
export function tokenFromReq(req) {
  return parseCookie(req.headers.cookie)[COOKIE_NAME] || '';
}

/**
 * 种下登录 cookie。
 * httpOnly 挡住 JS 读取（XSS 偷不走令牌）；SameSite=Lax 让 `<a href>` 导航
 * （群聊导出、文件下载）也能带上 cookie。
 * 不加 Secure —— 本机是明文 HTTP，加了浏览器根本不会发出这个 cookie。
 */
export function setAuthCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

/** 清掉登录 cookie。 */
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ===== 登录失败限流 =====
// 存内存：进程重启即清空可以接受，但没有限流就是明摆着让人爆破。
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const fails = new Map(); // username -> { count, until }

/** 该账号当前是否被锁；被锁则返回剩余秒数，否则 0。 */
export function lockedFor(username) {
  const rec = fails.get(username);
  if (!rec || !rec.until) return 0;
  const left = rec.until - Date.now();
  if (left <= 0) {
    fails.delete(username);
    return 0;
  }
  return Math.ceil(left / 1000);
}

/** 记一次登录失败，达到阈值就上锁。 */
export function recordFail(username) {
  const rec = fails.get(username) || { count: 0, until: 0 };
  rec.count++;
  if (rec.count >= MAX_FAILS) {
    rec.until = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  fails.set(username, rec);
}

/** 登录成功后清掉失败计数。 */
export function clearFails(username) {
  fails.delete(username);
}
