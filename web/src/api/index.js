// 后端接口封装。从旧 public/app.js 的 api 对象原样搬来，
// 只补了「响应体不是 JSON 时不要在错误处理里二次抛错」这一处健壮性。
// 撞到 401 时的回调。由 stores/auth.js 注册，避免 api ⇄ auth 互相 import。
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function toError(res) {
  let msg = res.statusText;
  try {
    const body = await res.json();
    if (body?.error) msg = body.error;
  } catch {
    // 响应不是 JSON（例如 502 网关页），保留 statusText
  }
  // 令牌过期/未登录：集中在这里退回登录页，不用每个调用点各写一遍。
  // 登录接口自己的 401（密码错误）不该触发——它由 auth store 直接处理，
  // 所以这里排掉 /api/auth/ 开头的请求。
  if (res.status === 401 && !new URL(res.url, location.origin).pathname.startsWith('/api/auth/')) {
    onUnauthorized?.();
  }
  return new Error(msg);
}

export const api = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw await toError(res);
    return res.json();
  },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },
  // 上传纯文本正文（群文件导入）。文件名走 query，body 直接是文本，无需 multipart。
  async sendText(url, text) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },
};

// 各板块的接口路径集中在此，避免散落在组件里拼字符串
export const endpoints = {
  authMe: '/api/auth/me',
  authLogin: '/api/auth/login',
  authRegister: '/api/auth/register',
  authLogout: '/api/auth/logout',
  features: '/api/features',
  stickers: '/api/stickers',
  personas: '/api/personas',
  persona: (id) => `/api/personas/${id}`,
  personaKb: (id) => `/api/personas/${id}/kb`,
  personaMemory: (id) => `/api/personas/${id}/memory`,
  sessions: '/api/sessions',
  sessionsOf: (personaId) => `/api/sessions?personaId=${personaId}`,
  session: (id) => `/api/sessions/${id}`,
  sessionMessages: (id) => `/api/sessions/${id}/messages`,
  groups: '/api/groups',
  group: (id) => `/api/groups/${id}`,
  groupMessages: (id) => `/api/groups/${id}/messages`,
  groupExport: (id) => `/api/groups/${id}/export`,
  groupKb: (id) => `/api/groups/${id}/kb`,
  groupFiles: (id, filename) => `/api/groups/${id}/files?filename=${encodeURIComponent(filename)}`,
  kbCategories: '/api/kb/categories',
  kbCategory: (id) => `/api/kb/categories/${id}`,
  kbEntries: '/api/kb/entries',
  kbEntry: (id) => `/api/kb/entries/${id}`,
  settings: '/api/settings',
  chat: '/api/chat',
  groupChat: '/api/group-chat',
  file: (id) => `/api/files/${id}`,
};
