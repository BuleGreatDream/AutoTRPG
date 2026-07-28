// 大模型设置。取代旧 app.js 的 loadSettings/saveSettings（app.js:1244-1274）。
// 后端约定（server.js /api/settings）：
//   GET  不回传密钥明文，只给 apiKeySet 布尔
//   PUT  apiKey 传空字符串视为「不改动」，避免误清空已有密钥
import { reactive } from 'vue';
import { api, endpoints } from '../api/index.js';

export const settings = reactive({
  baseUrl: '',
  model: '',
  apiKey: '', // 只做输入用；load 后永远清空，不承载后端返回值
  apiKeySet: false,
  loading: false,
  saving: false,
  msg: '',
  msgKind: '', // '' | 'ok' | 'err'
});

export async function loadSettings() {
  settings.loading = true;
  try {
    const s = await api.get(endpoints.settings);
    settings.baseUrl = s.baseUrl || '';
    settings.model = s.model || '';
    settings.apiKeySet = Boolean(s.apiKeySet);
    settings.apiKey = '';
  } catch (err) {
    settings.msg = `读取设置失败：${err.message}`;
    settings.msgKind = 'err';
  } finally {
    settings.loading = false;
  }
}

export async function saveSettings() {
  const body = { baseUrl: settings.baseUrl.trim(), model: settings.model.trim() };
  const key = settings.apiKey.trim();
  if (key) body.apiKey = key; // 留空则不提交该字段，后端保持原密钥

  settings.saving = true;
  try {
    const s = await api.send('PUT', endpoints.settings, body);
    settings.apiKeySet = Boolean(s.apiKeySet);
    settings.baseUrl = s.baseUrl || '';
    settings.model = s.model || '';
    settings.apiKey = '';
    flash('已保存并生效', 'ok');
  } catch (err) {
    settings.msg = `保存失败：${err.message}`;
    settings.msgKind = 'err';
  } finally {
    settings.saving = false;
  }
}

// 成功提示 3 秒后自动消失（失败提示保留，等用户改完再覆盖）。
// 连续保存时清掉上一个定时器，避免前一次的清空把后一次的提示提前抹掉。
let flashTimer = null;
function flash(msg, kind, ms = 3000) {
  settings.msg = msg;
  settings.msgKind = kind;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (settings.msgKind === 'ok') {
      settings.msg = '';
      settings.msgKind = '';
    }
    flashTimer = null;
  }, ms);
}
