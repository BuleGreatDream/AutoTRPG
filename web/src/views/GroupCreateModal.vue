<script setup>
// 新建群聊弹窗。取代旧 openGroupModal/closeGroupModal/createGroup。
import { ref, onMounted } from 'vue';
import { chat, loadGroups, selectGroup } from '../stores/chat.js';
import { api, endpoints } from '../api/index.js';
import KbAuthList from '../components/KbAuthList.vue';

const emit = defineEmits(['close']);

const name = ref('');
const topic = ref('');
const maxResponses = ref(3);
const memberIds = ref([]);
const kbEntryIds = ref([]);
const saving = ref(false);

function toggleMember(id) {
  const next = new Set(memberIds.value);
  next.has(id) ? next.delete(id) : next.add(id);
  memberIds.value = [...next];
}

async function create() {
  const n = name.value.trim();
  if (!n) { alert('请填写群聊名称'); return; }
  if (memberIds.value.length < 2) { alert('群聊至少选择 2 个人设'); return; }
  saving.value = true;
  try {
    const group = await api.send('POST', endpoints.groups, {
      name: n,
      topic: topic.value.trim(),
      maxResponses: Math.max(1, Math.min(10, Number(maxResponses.value) || 3)),
      memberIds: memberIds.value,
      kbEntryIds: kbEntryIds.value,
    });
    await loadGroups();
    await selectGroup(group.id);
    emit('close');
  } finally {
    saving.value = false;
  }
}

function onBackdrop(e) {
  if (e.target.id === 'group-modal') emit('close');
}
</script>

<template>
  <div id="group-modal" class="modal" @click="onBackdrop">
    <div class="modal-card">
      <div class="modal-head">
        <h3>新建群聊</h3>
        <button class="icon-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <label>群聊名称 <span class="req">*</span>
          <input v-model="name" type="text" placeholder="例如：周末去哪玩" />
        </label>
        <label>主题 / 场景
          <textarea v-model="topic" rows="2" placeholder="例如：一群老同学的周末聚会群，正在商量去哪露营"></textarea>
          <span class="field-hint">设定群聊的背景场景，AI 们会据此融入对话。可留空。</span>
        </label>
        <label>单次发言最多回应次数
          <input v-model.number="maxResponses" type="number" min="1" max="10" />
          <span class="field-hint">导演 AI 会在此上限内调度成员发言，防止无限循环。</span>
        </label>
        <label>选择成员 <span class="req">*</span>（至少 2 个）</label>
        <ul class="member-select">
          <li v-if="!chat.personas.length" class="empty">还没有人设卡，请先在上方创建至少 2 个人设。</li>
          <li v-for="p in chat.personas" :key="p.id" @click="toggleMember(p.id)">
            <input type="checkbox" :checked="memberIds.includes(p.id)" @click.stop="toggleMember(p.id)" />
            <span style="flex:1;cursor:pointer">{{ p.name }}</span>
          </li>
        </ul>
        <label>群聊可读资料</label>
        <KbAuthList :key="'group-new'" v-model="kbEntryIds" />
        <span class="field-hint">群内成员在自身人设授权之外，还能一起读到这里勾选的资料。可留空。</span>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn-primary" :disabled="saving" @click="create">
          {{ saving ? '创建中…' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>
