<script setup>
// 可读资料授权：按分类分组的条目复选。人设编辑器与群聊弹窗共用。
// 取代旧 renderKbAuthList + collectKbAuthIds——不再需要 idPrefix 参数（原本用于避免
// 多处渲染时 checkbox 元素 id 冲突），改为 v-model 绑定 id 数组，天然隔离。
import { ref, computed, onMounted } from 'vue';
import { api, endpoints } from '../api/index.js';

const model = defineModel({ type: Array, default: () => [] });

const entries = ref([]);
const categories = ref([]);
const state = ref('loading'); // 'loading' | 'ready' | 'error'

onMounted(async () => {
  try {
    const [es, cs] = await Promise.all([
      api.get(endpoints.kbEntries),
      api.get(endpoints.kbCategories),
    ]);
    entries.value = es;
    categories.value = cs;
    state.value = 'ready';
  } catch {
    state.value = 'error';
  }
});

// 按分类分组。「未分类」一组理论上不会出现（category_id 是 NOT NULL），
// 保留是为了兜住可能的历史脏数据，不至于让条目凭空消失。
const groups = computed(() => {
  const byCat = new Map(categories.value.map((c) => [c.id, { name: c.name, items: [] }]));
  const uncategorized = { name: '未分类', items: [] };
  for (const e of entries.value) {
    (byCat.get(e.category_id) || uncategorized).items.push(e);
  }
  return [...categories.value.map((c) => byCat.get(c.id)), uncategorized]
    .filter((g) => g && g.items.length);
});

function toggle(id) {
  const next = new Set(model.value);
  next.has(id) ? next.delete(id) : next.add(id);
  model.value = [...next];
}
</script>

<template>
  <div class="kb-auth-list">
    <div v-if="state === 'loading'" class="kb-auth-empty">加载中…</div>
    <div v-else-if="state === 'error'" class="kb-auth-empty">资料加载失败</div>
    <div v-else-if="!entries.length" class="kb-auth-empty">
      资料库还没有条目，可先去「资料库」添加。
    </div>
    <template v-else>
      <template v-for="g in groups" :key="g.name">
        <div class="kb-auth-group-title">{{ g.name }}</div>
        <!-- 整行可点：点行内任意处即切换勾选（原实现用 row.onclick 判断 target） -->
        <div v-for="e in g.items" :key="e.id" class="kb-auth-item" @click="toggle(e.id)">
          <input
            type="checkbox"
            :checked="model.includes(e.id)"
            @click.stop="toggle(e.id)"
          />
          <span style="flex: 1; cursor: pointer">{{ e.title }}</span>
        </div>
      </template>
    </template>
  </div>
</template>
