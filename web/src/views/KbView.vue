<script setup>
// 资料库主区：条目编辑器。取代旧 selectEntry/showEntryEditor/saveEntry/fillCategorySelect。
//
// 这里不提供「未分类」选项：kb_entries.category_id 是 NOT NULL（src/db.js:78），
// 未分类条目在库层面不存在。旧界面的下拉里有这一项，但选中后 kbEntries.update() 会走
// 「跳过 category_id 列」的分支以规避约束，结果是静默无变化却提示「已保存」。
// <select> 的 value 只能是字符串，故用 categoryModel 做数字转换。
import { computed } from 'vue';
import { kb, saveEntry } from '../stores/kb.js';

const categoryModel = computed({
  get: () => (kb.draft.categoryId == null ? '' : String(kb.draft.categoryId)),
  set: (v) => { kb.draft.categoryId = v === '' ? null : Number(v); },
});

async function onSave() {
  try {
    await saveEntry();
  } catch (err) {
    alert(err.message);
  }
}
</script>

<template>
  <div v-if="kb.activeEntryId" class="entry-editor">
    <div class="editor-head">
      <input
        v-model="kb.draft.title"
        type="text"
        class="entry-title-input"
        placeholder="条目标题"
      />
      <select v-model="categoryModel" class="entry-category-select" title="所属分类">
        <option v-for="c in kb.categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
      </select>
      <button class="btn-primary btn-sm" @click="onSave">
        {{ kb.saved ? '已保存' : '保存' }}
      </button>
    </div>
    <textarea
      v-model="kb.draft.content"
      class="entry-content-input"
      placeholder="在这里写下资料内容，AI 可按需检索引用…"
    ></textarea>
  </div>
  <div v-else class="empty-hint">从左侧选择或新建一个条目进行编辑。</div>
</template>
