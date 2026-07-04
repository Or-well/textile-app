<script setup lang="ts">
const props = defineProps<{
  searchText: string;
  sortKey: string;
  statusFilter: string;
  groupFilter: string;
  groups: Array<{ name: string; fileCount: number }>;
  canCreate: boolean;
  canManageFolder: boolean;
}>();

const emit = defineEmits<{
  addSource: [];
  batchAddSource: [];
  batchImportTranslation: [];
  addGroupedSources: [];
  updateSearchText: [value: string];
  updateSortKey: [value: string];
  updateStatusFilter: [value: string];
  updateGroupFilter: [value: string];
}>();
</script>

<template>
  <section class="file-toolbar" aria-label="文件工具栏">
    <details class="toolbar-menu">
      <summary :class="{ disabled: !canCreate }">添加文件</summary>
      <div class="menu-panel">
        <button type="button" :disabled="!canCreate" @click="emit('addSource')">
          添加源文件
        </button>
        <button type="button" :disabled="!canCreate" @click="emit('batchAddSource')">
          批量添加源文件
        </button>
        <button
          type="button"
          :disabled="!canCreate"
          @click="emit('batchImportTranslation')"
        >
          批量导入译文
        </button>
      </div>
    </details>

    <button
      class="secondary-button"
      type="button"
      :disabled="!canCreate || !canManageFolder"
      @click="emit('addGroupedSources')"
    >
      按分组添加
    </button>

    <select
      :value="props.statusFilter"
      aria-label="标签"
      @change="emit('updateStatusFilter', ($event.target as HTMLSelectElement).value)"
    >
      <option value="visible">默认显示</option>
      <option value="all">包含隐藏</option>
      <option value="hidden">只看隐藏</option>
      <option value="locked">只看锁定</option>
      <option value="disputed">有争议</option>
    </select>

    <select
      :value="props.groupFilter"
      aria-label="文件分组"
      @change="emit('updateGroupFilter', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">全部分组</option>
      <option value="__ungrouped__">未分组</option>
      <option v-for="group in groups" :key="group.name" :value="group.name">
        {{ group.name }}（{{ group.fileCount }}）
      </option>
    </select>

    <input
      :value="props.searchText"
      type="search"
      placeholder="搜索文件名"
      @input="emit('updateSearchText', ($event.target as HTMLInputElement).value)"
    />

    <select
      :value="props.sortKey"
      aria-label="排序"
      @change="emit('updateSortKey', ($event.target as HTMLSelectElement).value)"
    >
      <option value="name">按文件名</option>
      <option value="updated">按更新时间</option>
      <option value="translated">按已翻译</option>
      <option value="proofread">按已校对</option>
      <option value="reviewed">按已审核</option>
    </select>
  </section>
</template>

<style scoped>
.file-toolbar {
  display: grid;
  grid-template-columns: minmax(130px, auto) minmax(120px, auto) minmax(130px, auto) minmax(150px, auto) minmax(200px, 1fr) minmax(140px, auto);
  gap: var(--space-3);
  align-items: center;
  padding: var(--panel-padding-compact);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.toolbar-menu {
  position: relative;
}

.toolbar-menu summary {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--color-brand);
  color: var(--color-surface);
  font-weight: 700;
  font-size: var(--font-sm);
  cursor: pointer;
  list-style: none;
}

.toolbar-menu summary::-webkit-details-marker {
  display: none;
}

.toolbar-menu summary::after {
  content: "▼";
  margin-left: 8px;
  font-size: 10px;
}

.toolbar-menu summary.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.menu-panel {
  position: absolute;
  top: 40px;
  left: 0;
  z-index: 4;
  display: grid;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.menu-panel button {
  min-height: var(--control-sm);
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.menu-panel button:hover:not(:disabled) {
  background: #eef5f4;
}

.secondary-button,
input,
select {
  min-height: var(--control-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-sm);
}

.secondary-button {
  padding: 0 var(--space-5);
  cursor: pointer;
}

input,
select {
  min-width: 0;
  padding: 0 var(--space-4);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 980px) {
  .file-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-menu,
  .toolbar-menu summary,
  .secondary-button,
  input,
  select {
    width: 100%;
  }
}
</style>
