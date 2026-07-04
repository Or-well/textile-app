<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  itemUnit: string;
  selectedCount: number;
  applicableCount: number;
  skippedReasonCounts: Array<{ reason: string; count: number }>;
  affectedDetail?: string;
  note?: string;
  isExecuting?: boolean;
  danger?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click.self="!isExecuting && emit('cancel')"
  >
    <section
      class="batch-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-preview-title"
    >
      <header>
        <div>
          <p class="eyebrow">批量操作确认</p>
          <h2 id="batch-preview-title">{{ title }}</h2>
        </div>
        <button
          type="button"
          class="close-button"
          aria-label="关闭"
          :disabled="isExecuting"
          @click="emit('cancel')"
        >
          ×
        </button>
      </header>

      <dl class="preview-summary">
        <div>
          <dt>已选择</dt>
          <dd>{{ selectedCount }} {{ itemUnit }}</dd>
        </div>
        <div>
          <dt>可以处理</dt>
          <dd>{{ applicableCount }} {{ itemUnit }}</dd>
        </div>
        <div>
          <dt>将跳过</dt>
          <dd>{{ selectedCount - applicableCount }} {{ itemUnit }}</dd>
        </div>
      </dl>

      <p v-if="affectedDetail" class="affected-detail">{{ affectedDetail }}</p>

      <section v-if="skippedReasonCounts.length > 0" class="skip-list">
        <h3>跳过原因</h3>
        <ul>
          <li v-for="item in skippedReasonCounts" :key="item.reason">
            <span>{{ item.reason }}</span>
            <strong>{{ item.count }} {{ itemUnit }}</strong>
          </li>
        </ul>
      </section>

      <p class="dialog-note">
        {{ note || "执行时会重新读取数据并再次校验；已经变化的项目会按最新结果处理。" }}
      </p>

      <footer>
        <button
          type="button"
          class="secondary-button"
          :disabled="isExecuting"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="button"
          :class="danger ? 'danger-button' : 'primary-button'"
          :disabled="applicableCount === 0 || isExecuting"
          @click="emit('confirm')"
        >
          {{
            isExecuting
              ? "正在执行..."
              : `确认处理 ${applicableCount} ${itemUnit}`
          }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: var(--space-7);
  background: rgba(15, 23, 42, 0.46);
}

.batch-dialog {
  width: min(620px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.24);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--panel-padding);
}

header {
  border-bottom: 1px solid #e5e7eb;
}

footer {
  justify-content: flex-end;
  border-top: 1px solid #e5e7eb;
}

h2,
h3,
p,
dl,
ul {
  margin: 0;
}

h2 {
  font-size: 18px;
}

.eyebrow {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

.close-button {
  width: var(--control-md);
  min-height: var(--control-md);
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
}

.preview-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  padding: var(--panel-padding);
}

.preview-summary div {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

dt {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

dd {
  margin: var(--space-1) 0 0;
  color: var(--color-heading);
  font-size: 18px;
  font-weight: 700;
}

.affected-detail,
.dialog-note,
.skip-list {
  margin: 0 var(--panel-padding) var(--panel-padding);
}

.affected-detail,
.dialog-note {
  line-height: 1.5;
}

.affected-detail {
  color: #7c2d12;
}

.dialog-note {
  color: #5b6472;
}

.skip-list {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid #f0b96a;
  border-radius: var(--radius-sm);
  background: #fffaf0;
}

.skip-list ul {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  list-style: none;
}

.skip-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
}

.primary-button,
.secondary-button,
.danger-button {
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: var(--color-brand);
  color: var(--color-surface);
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

.danger-button {
  border: 0;
  background: #b42318;
  color: #ffffff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 640px) {
  .preview-summary {
    grid-template-columns: 1fr;
  }
}
</style>
