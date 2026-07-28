<script setup>
// 删除确认弹窗（会话/群聊共用）。取代旧 openDeleteModal/closeDeleteModal/performDelete。
// 由 chat._showDelete 控制显隐，chat.deleteTarget 提供目标信息。
import { ref } from 'vue';
import { chat, DELETE_KINDS, loadSessions, loadGroups } from '../stores/chat.js';
import { api } from '../api/index.js';

const saving = ref(false);
const error = ref('');

const t = () => chat.deleteTarget;
const cfg = () => DELETE_KINDS[t()?.kind] || DELETE_KINDS.session;

async function doDelete(summarize) {
  saving.value = true;
  error.value = '';
  try {
    await api.send('DELETE', cfg().url(t().id), { summarize });
  } catch (err) {
    error.value = err.message;
    saving.value = false;
    return;
  }
  const target = t();
  if (target.kind === 'session' && chat.activeSessionId === target.id) {
    chat.activeSessionId = null;
    chat.activeMode = null;
    chat.messages = [];
  } else if (target.kind === 'group' && chat.activeGroupId === target.id) {
    chat.activeGroupId = null;
    chat.activeMode = null;
    chat.messages = [];
  }
  if (target.kind === 'session') await loadSessions();
  else await loadGroups();
  close();
}

function close() {
  chat._showDelete = false;
  chat.deleteTarget = null;
}

function onBackdrop(e) {
  if (e.target.id === 'delete-modal') close();
}
</script>

<template>
  <div v-if="t()" id="delete-modal" class="modal" @click="onBackdrop">
    <div class="modal-card modal-card-sm">
      <div class="modal-head">
        <h3>{{ cfg().title }}</h3>
        <button class="icon-btn" @click="close">✕</button>
      </div>
      <div class="modal-body">
        <p class="delete-msg">{{ cfg().msg }}</p>
        <p v-if="error" class="delete-hint" style="color:var(--danger)">{{ error }}</p>
        <p v-else class="delete-hint">{{ cfg().hint }}</p>
      </div>
      <div class="modal-foot">
        <button class="btn-plain" :disabled="saving" @click="close">取消</button>
        <div class="spacer"></div>
        <button class="btn-danger" :disabled="saving" @click="doDelete(false)">直接删除</button>
        <button class="btn-primary" :disabled="saving" @click="doDelete(true)">保留为长期记忆并删除</button>
      </div>
    </div>
  </div>
</template>
