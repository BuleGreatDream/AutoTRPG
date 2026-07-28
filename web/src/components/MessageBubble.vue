<script setup>
// 单条消息气泡。文本/表情包/文件卡片/工具提示四种形态。
// msg 的结构：{ role, kind, content?, sticker?, file?, speaker?, showHead?, isGroup?, showReceipt? }
// showReceipt：user 消息专用，true 时在气泡左侧末端渲染「已读」。
// 必须渲染在 .msg.user 内部——CSS 选择器是 `.msg.user .read-receipt`，
// 放到外面会失去样式并在消息列里独立成行。
import AvatarImg from './AvatarImg.vue';

defineProps({
  msg: { type: Object, required: true },
});
</script>

<template>
  <!-- assistant 消息：[头像槽] + [气泡列] -->
  <div v-if="msg.role === 'assistant'" class="msg assistant">
    <AvatarImg
      v-if="msg.speaker"
      :name="msg.speaker.name"
      :avatar="msg.speaker.avatar"
      :cls="msg.showHead ? 'avatar-slot' : 'avatar-slot spacer'"
    />
    <div v-else class="avatar-slot spacer"></div>
    <div class="bubble-col">
      <div v-if="msg.isGroup && msg.showHead && msg.speaker?.name" class="speaker-name">
        {{ msg.speaker.name }}
      </div>
      <!-- 文本气泡 -->
      <div v-if="msg.kind === 'text'" class="bubble">{{ msg.content }}</div>
      <!-- 表情包 -->
      <img
        v-else-if="msg.kind === 'sticker'"
        class="sticker"
        :src="`/stickers/${msg.sticker.file}`"
        :alt="msg.sticker.id"
        :title="msg.sticker.id"
        @error="$el.remove()"
      />
      <!-- 文件卡片 -->
      <div v-else-if="msg.kind === 'file'" class="file-card">
        <svg class="file-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <div class="file-meta">
          <span class="file-name">{{ msg.file?.filename || '未命名' }}</span>
          <span class="file-sub">{{ msg.file?.format || '' }} · 可下载</span>
        </div>
        <a :href="msg.file?.id ? `/api/files/${msg.file.id}` : '#'" class="file-dl" title="下载" @click.stop>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      </div>
      <!-- 工具提示（搜索） -->
      <div v-else-if="msg.kind === 'tool'" class="tool-hint">{{ msg.content }}</div>
    </div>
  </div>

  <!-- user 消息：简化为单个气泡 -->
  <div v-else class="msg user">
    <!-- 已读回执：CSS order:-1 让它落在气泡左侧 -->
    <span v-if="msg.showReceipt" class="read-receipt">已读</span>
    <div v-if="msg.kind === 'sticker'">
      <img
        class="sticker"
        :src="`/stickers/${msg.sticker.file}`"
        :alt="msg.sticker.id"
        :title="msg.sticker.id"
        style="max-width: 160px; border-radius: 8px;"
      />
    </div>
    <div v-else class="bubble">{{ msg.content }}</div>
  </div>
</template>
