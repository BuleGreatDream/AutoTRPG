<script setup>
// 通用头像：有图显示图（背景图铺满），无图显示名字首字。
// 取代旧 fillAvatar()，样式类由调用方通过 cls 指定，以复用已有 CSS：
//   .persona-avatar（侧栏 26px）/ .avatar-slot（消息左侧 36px）/ .avatar-preview（编辑器 72px）
import { computed } from 'vue';
import { initialOf } from '../composables/useAvatar.js';

const props = defineProps({
  name: { type: String, default: '' },
  avatar: { type: String, default: null },
  cls: { type: String, default: 'persona-avatar' },
});

const style = computed(() => (props.avatar ? { backgroundImage: `url("${props.avatar}")` } : {}));
</script>

<template>
  <span :class="cls" :style="style">{{ avatar ? '' : initialOf(name) }}</span>
</template>
