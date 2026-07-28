<script setup>
// 最左图标导航条。四个板块的图标沿用旧 index.html 的单色 inline SVG（fill=currentColor），
// 不用 emoji，保证跨平台观感一致。
const VIEWS = [
  {
    key: 'chat',
    label: '聊天室',
    path: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z',
  },
  {
    key: 'personas',
    label: '人设卡',
    path: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z',
  },
  {
    key: 'kb',
    label: '资料库',
    path: 'M5 3h10a2 2 0 0 1 2 2v16l-7-3.5L3 21V5a2 2 0 0 1 2-2z',
  },
  {
    key: 'settings',
    label: '设置',
    path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4a7 7 0 0 0-.13-1.3l2.05-1.6-2-3.46-2.42.98a7 7 0 0 0-2.25-1.3L15.5 2h-4l-.75 2.02a7 7 0 0 0-2.25 1.3l-2.42-.98-2 3.46 2.05 1.6A7 7 0 0 0 3 12c0 .44.05.87.13 1.3l-2.05 1.6 2 3.46 2.42-.98a7 7 0 0 0 2.25 1.3L11.5 22h4l.75-2.02a7 7 0 0 0 2.25-1.3l2.42.98 2-3.46-2.05-1.6c.08-.43.13-.86.13-1.3z',
  },
];

defineProps({ active: { type: String, required: true } });
defineEmits(['switch']);
</script>

<template>
  <nav class="nav-rail">
    <button
      v-for="v in VIEWS"
      :key="v.key"
      class="nav-item"
      :class="{ active: active === v.key }"
      :title="v.label"
      @click="$emit('switch', v.key)"
    >
      <svg class="nav-ico" viewBox="0 0 24 24" fill="currentColor"><path :d="v.path" /></svg>
      <span class="nav-txt">{{ v.label }}</span>
    </button>
  </nav>
</template>
