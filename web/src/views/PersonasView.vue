<script setup>
// 人设卡主区：右侧内联编辑器。取代旧 openPersonaEditor/closePersonaEditor/savePersona/
// setAvatarPreview/onAvatarFileChosen/clearAvatar/deletePersonaFromModal。
import { ref, computed } from 'vue';
import {
  personas, editingAvatar, closeEditor, setAvatar, clearAvatar,
  savePersona, deletePersona, clearMemory,
} from '../stores/personas.js';
import { resizeImageToDataUrl } from '../composables/useAvatar.js';
import KbAuthList from '../components/KbAuthList.vue';

const fileInput = ref(null);

// 头像预览用背景图。data URL 里可能含引号，放在模板表达式里会被 HTML 解码搞坏，
// 因此在 script 里拼好再传给 :style。
const avatarStyle = computed(() =>
  editingAvatar.value ? { backgroundImage: `url("${editingAvatar.value}")` } : {}
);

// 六个文本字段：label 与 placeholder 沿用旧界面
const FIELDS = [
  { key: 'persona', label: '性格与身份', ph: '活泼、好奇，是一名咖啡店店员…' },
  { key: 'background', label: '背景故事', ph: '来自一座海边小城…' },
  { key: 'speakingStyle', label: '说话风格', ph: '语气轻快，爱用短句，偶尔卖萌…' },
  { key: 'greeting', label: '开场白', ph: '嗨，今天想聊点什么？' },
  { key: 'extra', label: '补充设定', ph: '其他任何设定…' },
];

async function onFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    setAvatar(await resizeImageToDataUrl(file));
  } catch (err) {
    alert(err.message || '处理图片失败');
  }
  e.target.value = ''; // 允许再次选同一个文件
}

async function onSave() {
  try {
    await savePersona();
    closeEditor();
  } catch (err) {
    alert(err.message);
  }
}

// 长期记忆的更新时间（"YYYY-MM-DD HH:mm"）
const memoryTime = computed(() => {
  const ms = personas.memory.updatedAt;
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

async function onClearMemory() {
  const id = personas.editingId;
  if (!id) return;
  const name = personas.draft.name || '该角色';
  if (!confirm(`清空${name}的全部长期记忆？\n\n此操作不可撤销，之后 TA 将不再记得过往会话的要点。当前会话窗口内的短期记忆不受影响。`)) return;
  try {
    await clearMemory(id);
  } catch (err) {
    alert(err.message || '清空失败');
  }
}

async function onDelete() {
  if (!personas.editingId) return;
  if (!confirm('删除该人设卡？其下所有会话与记忆也会一并删除。')) return;
  await deletePersona(personas.editingId);
  closeEditor();
}
</script>

<template>
  <div v-if="personas.editorOpen" class="persona-editor">
    <div class="editor-head">
      <h3>{{ personas.editingId ? '编辑人设卡' : '新建人设卡' }}</h3>
      <div class="spacer"></div>
      <button v-if="personas.editingId" class="btn-danger btn-sm" @click="onDelete">删除</button>
      <button class="btn-primary btn-sm" :disabled="personas.saving" @click="onSave">
        {{ personas.saving ? '保存中…' : '保存' }}
      </button>
    </div>

    <div class="persona-editor-body">
      <div class="avatar-field">
        <div
          class="avatar-preview"
          :class="{ 'has-image': editingAvatar }"
          :style="avatarStyle"
        >＋</div>
        <div class="avatar-field-info">
          <button type="button" class="btn-plain" @click="fileInput?.click()">上传头像</button>
          <button v-if="editingAvatar" type="button" class="btn-plain" @click="clearAvatar">
            移除
          </button>
          <span class="field-hint">支持 JPG/PNG，会自动裁剪缩放。</span>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onFileChosen"
        />
      </div>

      <label>角色名字 <span class="req">*</span>
        <input v-model="personas.draft.name" type="text" placeholder="例如：小林" />
      </label>
      <label v-for="f in FIELDS" :key="f.key">
        {{ f.label }}
        <textarea v-model="personas.draft[f.key]" rows="2" :placeholder="f.ph"></textarea>
      </label>

      <label>可读资料（资料库授权）</label>
      <!-- key 保证换人设时重新拉取并重建勾选状态 -->
      <KbAuthList :key="personas.editingId ?? 'new'" v-model="personas.kbEntryIds" />

      <!-- 长期记忆：仅已保存的人设有（新建卡还没有记忆） -->
      <template v-if="personas.editingId">
        <label>长期记忆
          <span v-if="memoryTime" class="mem-time">更新于 {{ memoryTime }}</span>
        </label>
        <div class="mem-box">
          <div v-if="personas.memory.state === 'loading'" class="mem-empty">加载中…</div>
          <div v-else-if="personas.memory.state === 'error'" class="mem-empty">记忆读取失败</div>
          <div v-else-if="!personas.memory.summary" class="mem-empty">
            还没有长期记忆。删除会话时选择「保留」才会归纳生成。
          </div>
          <pre v-else class="mem-text">{{ personas.memory.summary }}</pre>
        </div>
        <div class="mem-actions">
          <button
            type="button"
            class="btn-danger btn-sm"
            :disabled="!personas.memory.summary || personas.memory.clearing"
            @click="onClearMemory"
          >{{ personas.memory.clearing ? '清空中…' : '清空全部记忆' }}</button>
          <span class="field-hint">
            记忆是一条滚动摘要，归纳时新旧内容已融合，无法按单个会话删除，只能整体清空。
          </span>
        </div>
      </template>
    </div>
  </div>
  <div v-else class="empty-hint">选择左侧人设卡进行编辑，或点＋新建一张。</div>
</template>
