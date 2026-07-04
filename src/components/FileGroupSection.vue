<script setup lang="ts">
defineProps<{
  name: string;
  fileCount: number;
  collapsed: boolean;
  canManage: boolean;
  ungrouped?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  rename: [];
  clear: [];
}>();
</script>

<template>
  <section class="file-group">
    <header class="group-header">
      <button
        class="group-toggle"
        type="button"
        :aria-expanded="!collapsed"
        @click="emit('toggle')"
      >
        <span class="toggle-icon" aria-hidden="true">
          {{ collapsed ? "›" : "⌄" }}
        </span>
        <strong>{{ ungrouped ? "未分组" : name }}</strong>
        <span>{{ fileCount }} 个文件</span>
      </button>

      <details v-if="!ungrouped && canManage" class="group-menu">
        <summary>分组操作</summary>
        <div class="menu-panel">
          <button type="button" @click="emit('rename')">重命名分组</button>
          <button type="button" @click="emit('clear')">移出全部文件</button>
        </div>
      </details>
    </header>

    <div v-if="!collapsed" class="group-files">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.file-group {
  display: grid;
  gap: var(--space-3);
}

.group-header {
  display: flex;
  align-items: center;
  min-height: 38px;
  border-bottom: 1px solid #cfd7e2;
}

.group-toggle {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: 38px;
  padding: 0 var(--space-3);
  border: 0;
  background: transparent;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.group-toggle strong {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-toggle span:last-child {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

.toggle-icon {
  width: 18px;
  color: var(--color-brand);
  font-size: 20px;
  line-height: 1;
  text-align: center;
}

.group-files {
  display: grid;
  gap: var(--space-3);
}

.group-menu {
  position: relative;
  flex: 0 0 auto;
}

.group-menu summary {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-sm);
  cursor: pointer;
  list-style: none;
}

.group-menu summary::-webkit-details-marker {
  display: none;
}

.menu-panel {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 4;
  display: grid;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.menu-panel button {
  min-height: var(--control-sm);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.menu-panel button:hover {
  background: #eef5f4;
}
</style>
