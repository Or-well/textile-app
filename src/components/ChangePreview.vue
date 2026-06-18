<script setup lang="ts">
import type { ChangePackagePreview } from "../services/changes";

defineProps<{
  preview?: ChangePackagePreview;
  conflictCount: number;
}>();

function projectMatchText(preview: ChangePackagePreview): string {
  if (preview.validation.projectMatch === "matched") {
    return "已匹配";
  }

  if (preview.validation.projectMatch === "mismatched") {
    return "不匹配";
  }

  return "未校验";
}

function contentIntegrityText(preview: ChangePackagePreview): string {
  if (preview.validation.contentIntegrity === "passed") {
    return preview.contentHashShort
      ? `已通过（${preview.contentHashShort}）`
      : "已通过";
  }

  if (preview.validation.contentIntegrity === "failed") {
    return "未通过";
  }

  return "旧格式未校验";
}

function signatureStatusText(preview: ChangePackagePreview): string {
  if (preview.validation.signatureStatus === "valid") {
    return "签名有效";
  }

  if (preview.validation.signatureStatus === "invalid") {
    return "签名无效";
  }

  if (preview.validation.signatureStatus === "missing_public_key") {
    return "未配置成员公钥";
  }

  return preview.isLegacyPackage ? "未签名旧格式修改包" : "未签名";
}
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
        <dt>创建时间</dt>
        <dd>{{ preview.manifest.created_at }}</dd>
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
      <div>
        <dt>项目匹配</dt>
        <dd>{{ projectMatchText(preview) }}</dd>
      </div>
      <div>
        <dt>内容完整性</dt>
        <dd>{{ contentIntegrityText(preview) }}</dd>
      </div>
      <div>
        <dt>签名状态</dt>
        <dd>{{ signatureStatusText(preview) }}</dd>
      </div>
    </dl>

    <section v-if="preview.validation.riskMessages.length > 0" class="risk-panel">
      <h3>导入风险提示</h3>
      <ul>
        <li
          v-for="risk in preview.validation.riskMessages"
          :key="risk"
        >
          {{ risk }}
        </li>
      </ul>
    </section>
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

h3 {
  margin: 0;
  font-size: 15px;
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

dl > div {
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
  overflow-wrap: anywhere;
}

.risk-panel {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #f4c7c3;
  border-radius: 6px;
  background: #fff7f6;
}

ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  color: #9f1239;
  line-height: 1.6;
}

@media (max-width: 680px) {
  dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
