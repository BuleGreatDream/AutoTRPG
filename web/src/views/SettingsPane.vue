<script setup>
// 设置板块的中栏。原界面这里只有一句说明（设置项都在右主区），
// 正好用底部空间放当前账号与退出登录。
import { auth, logout } from '../stores/auth.js';

async function onLogout() {
  if (!confirm('退出登录？')) return;
  await logout();
}
</script>

<template>
  <div class="pane-view pane-view-fill">
    <div class="section-label">设置</div>
    <p class="pane-hint">在右侧配置大模型接口。</p>

    <div class="auth-foot">
      <div class="auth-foot-user">
        <span>当前账号</span> {{ auth.user?.username || '—' }}
      </div>
      <button class="btn-plain" @click="onLogout">退出登录</button>
    </div>
  </div>
</template>
