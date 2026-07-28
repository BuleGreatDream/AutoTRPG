// 后端接口封装。从旧 public/app.js 的 api 对象原样搬来，
// 只补了「响应体不是 JSON 时不要在错误处理里二次抛错」这一处健壮性。
async function toError(res) {
  let msg = res.statusText;
  try {
    const body = await res.json();
    if (body?.error) msg = body.error;
  } catch {
    // 响应不是 JSON（例如 502 网关页），保留 statusText
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
};

// 各板块的接口路径集中在此，避免散落在组件里拼字符串
export const endpoints = {
  features: '/api/features',
  stickers: '/api/stickers',
  personas: '/api/personas',
  persona: (id) => `/api/personas/${id}`,
  personaKb: (id) => `/api/personas/${id}/kb`,
  sessions: '/api/sessions',
  sessionsOf: (personaId) => `/api/sessions?personaId=${personaId}`,
  session: (id) => `/api/sessions/${id}`,
  sessionMessages: (id) => `/api/sessions/${id}/messages`,
  groups: '/api/groups',
  group: (id) => `/api/groups/${id}`,
  groupMessages: (id) => `/api/groups/${id}/messages`,
  groupExport: (id) => `/api/groups/${id}/export`,
  groupKb: (id) => `/api/groups/${id}/kb`,
  kbCategories: '/api/kb/categories',
  kbCategory: (id) => `/api/kb/categories/${id}`,
  kbEntries: '/api/kb/entries',
  kbEntry: (id) => `/api/kb/entries/${id}`,
  settings: '/api/settings',
  chat: '/api/chat',
  groupChat: '/api/group-chat',
  file: (id) => `/api/files/${id}`,
};
