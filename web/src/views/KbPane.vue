<script setup>
// 资料库中栏：分类（只增删）+ 条目（展示全部，标注所属分类）。
// 取代旧 renderCategories / renderEntries，class 沿用原 index.html。
import { onMounted } from 'vue';
import {
  kb, loadCategories, createCategory, removeCategory,
  createEntry, removeEntry, selectEntry,
} from '../stores/kb.js';

onMounted(loadCategories);

async function onAddCategory() {
  const name = (prompt('分类名称：') || '').trim();
  if (!name) return;
  await createCategory(name);
}

async function onDelCategory(c) {
  if (!confirm(`删除分类「${c.name}」？其下所有条目会一并删除。`)) return;
  await removeCategory(c.id);
}

async function onAddEntry() {
  try {
    await createEntry();
  } catch (err) {
    alert(err.message);
  }
}

async function onDelEntry(e) {
  if (!confirm(`删除条目「${e.title}」？`)) return;
  await removeEntry(e.id);
}
</script>

<template>
  <div class="pane-view">
    <div class="section-label">
      <span>分类</span>
      <button class="icon-btn" title="新建分类" @click="onAddCategory">＋</button>
    </div>
    <ul class="session-list">
      <li v-if="!kb.categories.length" class="empty">点右上 ＋ 新建分类</li>
      <li v-for="c in kb.categories" :key="c.id">
        <span style="flex: 1">{{ c.name }}</span>
        <span class="edit" @click.stop="onDelCategory(c)">删除</span>
      </li>
    </ul>

    <div class="section-label">
      <span>条目</span>
      <button class="icon-btn" title="新建条目" @click="onAddEntry">＋</button>
    </div>
    <ul class="session-list">
      <li v-if="!kb.entries.length" class="empty">点右上 ＋ 新建条目</li>
      <li
        v-for="e in kb.entries"
        :key="e.id"
        :class="{ active: e.id === kb.activeEntryId }"
        @click="selectEntry(e.id)"
      >
        <span style="flex: 1">{{ e.title }}</span>
        <span v-if="e.category_name" class="entry-cat-tag">{{ e.category_name }}</span>
        <span class="edit" @click.stop="onDelEntry(e)">删除</span>
      </li>
    </ul>
  </div>
</template>
