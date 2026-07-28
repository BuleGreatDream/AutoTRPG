<script setup>
// 三栏骨架：最左图标条 + 中栏列表 + 右主区。
// 取代旧 app.js 的 switchView()——原先要手动同步 .nav-item / .pane-view / .main-view
// 三处的显隐，现在由 activeView 一处推导，各板块用 v-if 挂载。
import { ref } from 'vue';
import NavRail from './components/NavRail.vue';
import SettingsPane from './views/SettingsPane.vue';
import SettingsView from './views/SettingsView.vue';
import KbPane from './views/KbPane.vue';
import KbView from './views/KbView.vue';
import PersonasPane from './views/PersonasPane.vue';
import PersonasView from './views/PersonasView.vue';
import ChatPane from './views/ChatPane.vue';
import ChatView from './views/ChatView.vue';
import { initChat } from './stores/chat.js';
import './styles/index.css';

// 'chat' | 'personas' | 'kb' | 'settings'
const activeView = ref('chat');

// 初始化聊天室（features + stickers + personas + groups）
initChat();
</script>

<template>
  <div class="app">
    <NavRail :active="activeView" @switch="activeView = $event" />

    <aside class="list-pane">
      <SettingsPane v-if="activeView === 'settings'" />
      <KbPane v-else-if="activeView === 'kb'" />
      <PersonasPane v-else-if="activeView === 'personas'" />
      <ChatPane v-else-if="activeView === 'chat'" />
      <div v-else class="pane-view">
        <div class="section-label">未知板块</div>
        <p class="pane-hint">中栏列表待接入。</p>
      </div>
    </aside>

    <main class="main">
      <!-- 各板块进入时才挂载：数据加载放在组件 onMounted，取代旧 switchView 里的按需 load -->
      <div v-if="activeView === 'settings'" class="main-view">
        <SettingsView />
      </div>
      <div v-else-if="activeView === 'kb'" class="main-view">
        <KbView />
      </div>
      <div v-else-if="activeView === 'personas'" class="main-view">
        <PersonasView />
      </div>
      <div v-else-if="activeView === 'chat'" class="main-view">
        <ChatView />
      </div>
      <div v-else class="main-view">
        <div class="empty-hint">未知板块</div>
      </div>
    </main>
  </div>
</template>
