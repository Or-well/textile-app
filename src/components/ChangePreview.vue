<script setup lang="ts">
import type { ChangePackagePreview } from "../services/changes";

defineProps<{
  preview?: ChangePackagePreview;
  conflictCount: number;
}>();
</script>

<template>
  <section v-if="preview" class="change-preview">
    <h2>修改包预览</h2>

    <dl>
      <div>
        <dt>提交者</dt>
        <dd>{{ preview.manifest.user_name || preview.manifest.user_id }}</dd>
      </div>
      <div>
        <dt>任务</dt>
        <dd>{{ preview.manifest.task_id }}</dd>
      </div>
      <div>
        <dt>修改词条</dt>
        <dd>{{ preview.changedEntries }}</dd>
      </div>
      <div>
        <dt>新增评论</dt>
        <dd>{{ preview.commentCount }}</dd>
      </div>
      <div>
        <dt>日志</dt>
        <dd>{{ preview.logCount }}</dd>
      </div>
      <div>
        <dt>冲突</dt>
        <dd>{{ conflictCount }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.change-preview {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

h2 {
  margin: 0;
  font-size: 18px;
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

div {
  padding: 12px;
  border: 1px solid #eef1f5;
  border-radius: 6px;
  background: #f9fafb;
}

dt {
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin: 6px 0 0;
  font-weight: 700;
}

@media (max-width: 680px) {
  dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
