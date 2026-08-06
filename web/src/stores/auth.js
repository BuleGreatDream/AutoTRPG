// 登录态。与其他 store 一样是 reactive() 模块，组件直接 import。
//
// 令牌不在这里——它是后端种的 httpOnly cookie，前端读不到也不需要读，
// 同源请求（含 SSE 与 <a href> 下载）浏览器会自动带上。
// 这里只存「当前是谁」，用来决定 App.vue 显示登录页还是主界面。
import { reactive } from 'vue';
import { api, endpoints, setUnauthorizedHandler } from '../api/index.js';

export const auth = reactive({
  user: null,          // { id, username } | null
  checked: false,      // 是否已问过后端。false 时 App.vue 什么都不渲染，避免首屏闪一下登录页
  allowRegister: true, // 后端 ALLOW_REGISTER 开关，决定登录页是否显示「注册」入口
  submitting: false,
  error: '',
});

/** 启动时问一次后端「我是谁」。失败（含未登录）都落到 user=null。 */
export async function fetchMe() {
  try {
    const res = await api.get(endpoints.authMe);
    auth.user = res.user || null;
    auth.allowRegister = res.allowRegister !== false;
  } catch {
    // 网络错误或后端没起：当未登录处理，登录页会把真实错误显示出来
    auth.user = null;
  } finally {
    auth.checked = true;
  }
}

// 登录与注册只差一个 URL，共用一套提交流程
async function submit(url, username, password) {
  auth.submitting = true;
  auth.error = '';
  try {
    const res = await api.send('POST', url, { username, password });
    auth.user = res.user;
    return true;
  } catch (err) {
    auth.error = err.message || '操作失败';
    return false;
  } finally {
    auth.submitting = false;
  }
}

export function login(username, password) {
  return submit(endpoints.authLogin, username, password);
}

export function register(username, password) {
  return submit(endpoints.authRegister, username, password);
}

export async function logout() {
  try {
    await api.send('POST', endpoints.authLogout);
  } catch {
    // 即便后端删令牌失败也把前端置为未登录，用户能重新登录
  }
  auth.user = null;
}

/**
 * 令牌过期/未登录时退回登录页。
 * 两个入口都要用：api 层（下面注册）覆盖所有走 api.get/send 的调用，
 * useChatStream.js 是裸 fetch，得自己调一次。
 */
export function handleUnauthorized() {
  auth.user = null;
  auth.checked = true;
}

// 注册在 api 层，避免 api ⇄ auth 互相 import
setUnauthorizedHandler(handleUnauthorized);
