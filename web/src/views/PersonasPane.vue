<script setup>
// 人设卡管理中栏：整行点击即编辑。取代旧 renderPersonaManageList。
import { onMounted } from 'vue';
import { personas, loadPersonas, openEditor } from '../stores/personas.js';
import AvatarImg from '../components/AvatarImg.vue';

onMounted(() => {
  if (!personas.list.length) loadPersonas();
});
</script>

<template>
  <div class="pane-view">
    <div class="section-label">
      <span>人设卡</span>
      <button class="icon-btn" title="新建人设" @click="openEditor(null)">＋</button>
    </div>
    <ul class="persona-list">
      <li v-if="!personas.list.length" class="empty">还没有人设卡，点右上角 ＋ 新建。</li>
      <li
        v-for="p in personas.list"
        :key="p.id"
        :class="{ active: p.id === personas.editingId }"
        @click="openEditor(p)"
      >
        <AvatarImg :name="p.name" :avatar="p.avatar" />
        <span style="flex: 1">{{ p.name }}</span>
      </li>
    </ul>
  </div>
</template>
