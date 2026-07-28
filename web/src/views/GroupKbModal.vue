<script setup>
// 群聊资料授权弹窗（建群后随时修改）。取代旧 openGroupKbModal/saveGroupKb。
import { ref, watch, onMounted } from 'vue';
import { chat, loadGroups } from '../stores/chat.js';
import { api, endpoints } from '../api/index.js';

const props = defineProps({ groupId: { type: Number, required: true } });
const emit = defineEmits(['close']);

const entryIds = ref([]);
const loaded = ref(false);

async function load() {
  try {
    const res = await api.get(endpoints.groupKb(props.groupId));
    entryIds.value = res.entryIds || [];
  } catch { /* 忽略 */ }
  loaded.value = true;
}

async function save() {
  await api.send('PUT', endpoints.groupKb(props.groupId), { entryIds: entryIds.value });
  await loadGroups();
  emit('close');
}

watch(() => props.groupId, load, { immediate: true });

function onBackdrop(e) {
  if (e.target.id === 'group-kb-modal') emit('close');
}
</script>

<template>
  <div id="group-kb-modal" class="modal" @click="onBackdrop">
    <div class="modal-card">
      <div class="modal-head">
        <h3>群聊可读资料</h3>
        <button class="icon-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <span class="field-hint">勾选本群成员可共同查阅的资料，与各成员自身人设的授权合并生效。</span>
        <KbAuthList :key="`group-${props.groupId}`" v-model="entryIds" />
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn-primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
