<script setup>
// 聊天室主区：头部 + 消息列表 + 输入区 + 三个弹窗（删除/建群/群资料）。
// 取代旧 app.js 聊天相关所有 DOM 操作，SSE 流式逻辑在 useChatStream.js 里。
import { ref, computed, nextTick, watch } from 'vue';
import {
  chat, renderMessages, currentChatKey, isSending,
  uploadGroupFiles, GROUP_FILE_ACCEPT,
} from '../stores/chat.js';
import { useChatStream } from '../composables/useChatStream.js';
import MessageBubble from '../components/MessageBubble.vue';
import DeleteModal from './DeleteModal.vue';
import GroupCreateModal from './GroupCreateModal.vue';
import GroupKbModal from './GroupKbModal.vue';

// ===== 流式与消息 =====
const messagesEl = ref(null);
const inputEl = ref(null);
let stream = null;

const inputText = ref('');

// 正在输入
const typingName = ref('');
const typingVisible = ref(false);

// 已读回执：记录收到回执的那条 user 消息在 chat.messages 里的下标。
// 只标一条（本次发送的那条），历史消息不带已读——和旧 app.js 行为一致。
const readReceiptIndex = ref(-1);

// 渲染列表：在 store 的 showHead/isGroup 之上再注入 showReceipt
const readyMessages = computed(() =>
  renderMessages().map((m, i) => (i === readReceiptIndex.value ? { ...m, showReceipt: true } : m))
);

// 流式锁（派生自 store）
const locked = computed(() => isSending(currentChatKey()));

// 弹窗（与 ChatPane 共享，通过 chat store 通信）
const groupKbGroupId = ref(null);

// ===== useChatStream 回调 =====
function onPush(msg, opts = {}) {
  if (msg._typing !== undefined) {
    // 输入中信号
    if (msg._typing) {
      typingName.value = msg._typing;
      typingVisible.value = true;
    } else {
      typingVisible.value = false;
      typingName.value = '';
    }
    return;
  }
  if (msg._done) {
    typingVisible.value = false;
    return;
  }
  if (msg._reload) {
    // 切回后重拉完成，列表已被整体替换，旧下标失效
    typingVisible.value = false;
    readReceiptIndex.value = -1;
    return;
  }
  if (msg._receipt) {
    // 给最后一条 user 消息打上已读标记（淡入动画由 CSS 负责）
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') { readReceiptIndex.value = i; break; }
    }
    return;
  }
  if (msg._tool) {
    const scope = msg._tool.domains?.length ? `（限 ${msg._tool.domains.join('、')}）` : '';
    chat.messages.push({
      role: 'assistant', kind: 'tool',
      content: `🔍 正在联网搜索${scope}：${msg._tool.query}`,
    });
    return;
  }
  // 普通消息
  chat.messages.push(msg);
}

// 每次消息变化后滚动到底部
watch(() => chat.messages.length, async () => {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
});

// ===== 发送 =====
// 用户也可以从外部触发表情包发送（chat.stickers 保留供 AI 端使用，用户端不再展示选择面板）
async function doSend(sticker = null) {
  if (locked.value) return;
  if (!sticker && !inputText.value.trim()) return;
  if (!currentChatKey()) return;

  const text = sticker ? '' : inputText.value.trim();

  if (!stream) stream = useChatStream(onPush);

  // 用户气泡由 useChatStream.send() 内部推出（校验通过后统一一处），
  // 这里只负责清空输入框并复位自适应高度。
  if (!sticker) {
    inputText.value = '';
    await nextTick();
    if (inputEl.value) inputEl.value.style.height = 'auto';
  }

  await stream.send(text, sticker);
}

// ===== 群文件上传 =====
// 选中的文本文件转成资料库条目并自动授权给本群，结果以一条系统提示气泡反馈（不落库）。
const fileInputEl = ref(null);
const uploading = ref(false);

function pickGroupFiles() {
  fileInputEl.value?.click();
}

async function onGroupFilesPicked(e) {
  const files = [...(e.target.files || [])];
  e.target.value = ''; // 允许重复选同一个文件
  const groupId = chat.activeGroupId;
  if (!files.length || !groupId) return;

  uploading.value = true;
  try {
    const { ok, fail } = await uploadGroupFiles(groupId, files);
    const parts = [];
    if (ok.length) {
      const cat = ok[0].category;
      const names = ok.map((f) => f.name).join('、');
      parts.push(`📄 已把 ${names} 存入资料库${cat ? `「${cat}」` : ''}，本群成员现在可以查阅`);
    }
    for (const f of fail) parts.push(`⚠️ ${f.name} 上传失败：${f.error}`);
    // 只在仍停留在该群时提示，避免串到别的会话里
    if (chat.activeMode === 'group' && chat.activeGroupId === groupId) {
      for (const content of parts) {
        chat.messages.push({ role: 'assistant', kind: 'tool', content });
      }
    }
  } finally {
    uploading.value = false;
  }
}

// ===== 切会话时清理流 =====
watch(currentChatKey, () => {
  if (stream) {
    stream.abort();
    stream = null;
  }
  typingVisible.value = false;
  typingName.value = '';
  readReceiptIndex.value = -1;
});

// ===== 键盘发送 =====
function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
}

// textarea 自适应高度
function autoResize(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ===== 生命周期 =====
</script>

<template>
  <!-- ===== 头部 ===== -->
  <header class="chat-head">
    <div class="chat-head-info">
      <div class="chat-title">{{ chat.chatTitle }}</div>
      <div class="chat-status" :class="{ visible: typingVisible }">
        <template v-if="typingVisible">{{ typingName }}<span class="dots"></span>正在输入</template>
      </div>
    </div>
    <div class="chat-head-right">
      <!-- 群聊时显示资料/导出按钮 -->
      <template v-if="chat.activeMode === 'group'">
        <input
          ref="fileInputEl"
          type="file"
          multiple
          :accept="GROUP_FILE_ACCEPT"
          style="display: none"
          @change="onGroupFilesPicked"
        />
        <button
          class="btn-plain btn-sm"
          :disabled="uploading"
          title="上传文本文件，自动存入资料库并对本群开放"
          @click="pickGroupFiles"
        >{{ uploading ? '上传中…' : '上传文件' }}</button>
        <button class="btn-plain btn-sm" @click="groupKbGroupId = chat.activeGroupId">资料</button>
        <a class="btn-plain btn-sm" :href="`/api/groups/${chat.activeGroupId}/export`" style="text-decoration:none">导出</a>
      </template>
      <!-- 特性标签 -->
      <div class="badges">
        <span v-for="(on, label) in chat.features" :key="label" class="badge" :class="{ off: !on }">
          {{ on ? '● ' : '○ ' }}{{ { webSearch: '联网搜索', longTermMemory: '长期记忆', stickers: '表情包', groupChat: '群聊' }[label] || label }}
        </span>
      </div>
    </div>
  </header>

  <!-- ===== 消息列表 ===== -->
  <div ref="messagesEl" class="messages">
    <div v-if="!readyMessages.length && !locked" class="empty-hint">开始对话吧</div>
    <!-- 已读回执由 MessageBubble 渲染在 .msg.user 内部（靠 msg.showReceipt） -->
    <MessageBubble v-for="(m, i) in readyMessages" :key="i" :msg="m" />
  </div>

  <!-- ===== 输入区 ===== -->
  <footer class="composer">
    <textarea
      id="input"
      ref="inputEl"
      v-model="inputText"
      placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
      rows="1"
      :disabled="locked || !currentChatKey()"
      @input="autoResize"
      @keydown="onKeydown"
    ></textarea>
    <button
      id="send-btn"
      :disabled="locked || !inputText.trim() || !currentChatKey()"
      @click="doSend()"
    >发送</button>
  </footer>

  <!-- ===== 弹窗 ===== -->
  <DeleteModal v-if="chat._showDelete" />
  <GroupCreateModal v-if="chat._showGroupModal" @close="chat._showGroupModal = false" />
  <GroupKbModal v-if="groupKbGroupId" :group-id="groupKbGroupId" @close="groupKbGroupId = null" />
</template>
