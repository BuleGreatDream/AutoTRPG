<script setup>
// 设置主区。结构与 class 沿用旧 index.html 的 .settings-form 段，样式无需改动。
import { computed, onMounted } from 'vue';
import { settings, loadSettings, saveSettings } from '../stores/settings.js';

onMounted(loadSettings);

const keyHint = computed(() =>
  settings.apiKeySet ? '当前状态：已配置（留空则不修改）' : '当前状态：未配置'
);
</script>

<template>
  <div class="settings-form">
    <h2 class="settings-title">大模型设置</h2>
    <p class="field-hint">修改后保存会写入 .env 并立即生效（无需重启）。</p>

    <label>
      接口地址 Base URL
      <input v-model="settings.baseUrl" type="text" placeholder="https://api.deepseek.com/v1" />
    </label>

    <label>
      模型名 Model
      <input v-model="settings.model" type="text" placeholder="deepseek-v4-flash" />
    </label>

    <label>
      API Key
      <input
        v-model="settings.apiKey"
        type="password"
        placeholder="留空则不修改现有密钥"
        autocomplete="off"
      />
      <span class="field-hint">{{ keyHint }}</span>
    </label>

    <div class="settings-foot">
      <span class="settings-msg" :class="settings.msgKind">{{ settings.msg }}</span>
      <button class="btn-primary" :disabled="settings.saving" @click="saveSettings">
        {{ settings.saving ? '保存中…' : '保存设置' }}
      </button>
    </div>
  </div>
</template>
