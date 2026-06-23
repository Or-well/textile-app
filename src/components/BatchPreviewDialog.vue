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
  padding: 24px;
  background: rgba(15, 23, 42, 0.46);
}

.batch-dialog {
  width: min(620px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.24);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
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
  font-size: 22px;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
}

.close-button {
  width: 36px;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
}

.preview-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 18px;
}

.preview-summary div {
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafc;
}

dt {
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin: 5px 0 0;
  color: #111827;
  font-size: 20px;
  font-weight: 700;
}

.affected-detail,
.dialog-note,
.skip-list {
  margin: 0 18px 18px;
}

.affected-detail,
.dialog-note {
  line-height: 1.65;
}

.affected-detail {
  color: #7c2d12;
}

.dialog-note {
  color: #5b6472;
}

.skip-list {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #f0b96a;
  border-radius: 6px;
  background: #fffaf0;
}

.skip-list ul {
  display: grid;
  gap: 6px;
  padding: 0;
  list-style: none;
}

.skip-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.primary-button,
.secondary-button,
.danger-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
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
