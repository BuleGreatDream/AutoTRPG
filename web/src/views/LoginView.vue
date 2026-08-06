<script setup>
// 登录 / 注册。同一个组件靠 mode 切换，两者只差一个接口地址。
// 样式沿用现有 CSS 变量与 .btn-primary，不引新的设计语言（见 styles/auth.css）。
import { ref, computed, watch } from 'vue';
import { auth, login, register } from '../stores/auth.js';

const mode = ref('login'); // 'login' | 'register'
const username = ref('');
const password = ref('');
const password2 = ref('');

const isRegister = computed(() => mode.value === 'register');

// 提交按钮的禁用条件：必填项没填全、正在提交、或注册时两次密码不一致
const canSubmit = computed(() => {
  if (auth.submitting) return false;
  if (!username.value.trim() || !password.value) return false;
  if (isRegister.value && password.value !== password2.value) return false;
  return true;
});

// 两次密码不一致的即时提示（只在用户已经开始填第二个框时才显示）
const mismatch = computed(
  () => isRegister.value && password2.value.length > 0 && password.value !== password2.value
);

// 切换模式时清掉上一个模式留下的报错与确认密码
watch(mode, () => {
  auth.error = '';
  password2.value = '';
});

async function onSubmit() {
  if (!canSubmit.value) return;
  const fn = isRegister.value ? register : login;
  const ok = await fn(username.value.trim(), password.value);
  if (!ok) password.value = password2.value = ''; // 失败清密码，账号留着好改
}
</script>

<template>
  <div class="auth-screen">
    <form class="auth-card" @submit.prevent="onSubmit">
      <div class="auth-brand">
        <div class="auth-logo">◈</div>
        <h1 class="auth-title">AI 人格化聊天室</h1>
        <p class="auth-sub">{{ isRegister ? '创建一个账号开始使用' : '登录后继续你的对话' }}</p>
      </div>

      <label>
        账号
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          placeholder="3-32 个字符"
          :disabled="auth.submitting"
        />
      </label>

      <label>
        密码
        <input
          v-model="password"
          type="password"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          placeholder="至少 6 位"
          :disabled="auth.submitting"
        />
      </label>

      <label v-if="isRegister">
        确认密码
        <input
          v-model="password2"
          type="password"
          autocomplete="new-password"
          placeholder="再输一次"
          :disabled="auth.submitting"
        />
        <span v-if="mismatch" class="auth-msg err">两次输入的密码不一致</span>
      </label>

      <p v-if="auth.error" class="auth-msg err">{{ auth.error }}</p>

      <button class="btn-primary auth-submit" type="submit" :disabled="!canSubmit">
        {{ auth.submitting ? '请稍候…' : (isRegister ? '注册并登录' : '登录') }}
      </button>

      <p v-if="auth.allowRegister" class="auth-switch">
        <template v-if="isRegister">
          已有账号？<button type="button" @click="mode = 'login'">去登录</button>
        </template>
        <template v-else>
          还没有账号？<button type="button" @click="mode = 'register'">注册</button>
        </template>
      </p>
    </form>
  </div>
</template>
