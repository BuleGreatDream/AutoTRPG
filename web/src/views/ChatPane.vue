<script setup>
// 聊天室中栏：人设列表 / 会话列表 / 群聊列表。
// 取代旧 renderPersonas/renderSessions/renderGroups + selectPersona/selectSession/selectGroup。
import { chat, selectPersona, createSession, selectSession, selectGroup, DELETE_KINDS } from '../stores/chat.js';
import AvatarImg from '../components/AvatarImg.vue';

function openDeleteModal(kind, id) {
  chat.deleteTarget = { kind, id };
  chat._showDelete = true;
}
function openGroupModal() {
  chat._showGroupModal = true;
}
</script>

<template>
  <div class="pane-view">
    <!-- 加载中 / 加载失败 / 正常 -->
    <template v-if="!chat.loaded">
      <div class="section-label">聊天室</div>
      <p v-if="chat.loadError" class="pane-hint" style="color:var(--danger)">加载失败：{{ chat.loadError }}</p>
      <p v-else class="pane-hint">正在加载数据…</p>
    </template>
    <template v-else>
    <!-- 人设 -->
    <div class="section-label">人设</div>
    <ul class="persona-list">
      <li
        v-for="p in chat.personas"
        :key="p.id"
        :class="{ active: p.id === chat.activePersonaId }"
        @click="selectPersona(p.id)"
      >
        <AvatarImg :name="p.name" :avatar="p.avatar" />
        <span style="flex: 1">{{ p.name }}</span>
      </li>
    </ul>

    <!-- 会话 -->
    <div class="section-label session-label">
      <span>会话</span>
      <button
        class="icon-btn"
        title="新建会话"
        :disabled="!chat.activePersonaId"
        @click="createSession"
      >＋</button>
    </div>
    <ul class="session-list">
      <li
        v-for="s in chat.sessions"
        :key="s.id"
        :class="{ active: s.id === chat.activeSessionId }"
        @click="selectSession(s.id)"
      >
        <span style="flex: 1">{{ s.title }}</span>
        <span class="edit" @click.stop="openDeleteModal('session', s.id)">删除</span>
      </li>
    </ul>

    <!-- 群聊 -->
    <div class="section-label">
      <span>群聊</span>
      <button class="icon-btn" title="新建群聊" @click="openGroupModal">＋</button>
    </div>
    <ul class="session-list">
      <li
        v-for="g in chat.groups"
        :key="g.id"
        :class="{ active: g.id === chat.activeGroupId }"
        @click="selectGroup(g.id)"
      >
        <span style="flex: 1">{{ g.name }}</span>
        <span class="edit" @click.stop="openDeleteModal('group', g.id)">删除</span>
      </li>
    </ul>
    </template>
  </div>
</template>
