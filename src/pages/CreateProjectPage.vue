<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member, ProofreadRequired } from "../model/types";
import {
  createProjectInDirectory,
  selectProjectCreationDirectory,
  type OpenedProject,
} from "../services/project";
import type { ProjectDirectoryHandle } from "../services/projectFs";

const emit = defineEmits<{
  created: [project: OpenedProject, owner: Member];
  cancel: [];
}>();

const locationRoot = ref<ProjectDirectoryHandle | null>(null);
const projectName = ref("");
const description = ref("");
const sourceLanguage = ref("ja");
const targetLanguage = ref("zh-Hans");
const enableTasks = ref(true);
const enableProofread = ref(true);
const enableReview = ref(true);
const requireSignedChangePackages = ref(true);
const allowSelfProofread = ref(true);
const allowSelfReview = ref(true);
const allowSameUserMultiProofread = ref(true);
const proofreadRequired = ref<ProofreadRequired>(1);
const translationWeight = ref(40);
const proofreadWeight = ref(30);
const reviewWeight = ref(30);
const ownerName = ref("owner");
const ownerPassword = ref("");
const confirmPassword = ref("");
const isSelectingLocation = ref(false);
const isCreating = ref(false);
const message = ref("");
const errorMessage = ref("");

const selectedLocationText = computed(
  () => locationRoot.value?.name ?? "尚未选择创建位置",
);
const weightTotal = computed(
  () =>
    Number(translationWeight.value) +
    Number(proofreadWeight.value) +
    Number(reviewWeight.value),
);
const canCreate = computed(
  () =>
    !isCreating.value &&
    Boolean(locationRoot.value) &&
    projectName.value.trim().length > 0 &&
    ownerName.value.trim().length > 0 &&
    ownerPassword.value.length > 0 &&
    ownerPassword.value === confirmPassword.value &&
    weightTotal.value === 100,
);

async function handleSelectLocation() {
  isSelectingLocation.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    locationRoot.value = await selectProjectCreationDirectory();
    message.value = `已选择创建位置：${locationRoot.value.name}`;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有选择创建位置。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "无法选择创建位置。请确认浏览器支持本地文件夹。";
    }
  } finally {
    isSelectingLocation.value = false;
  }
}

function validateForm(): boolean {
  if (!locationRoot.value) {
    errorMessage.value = "请先选择创建位置。";
    return false;
  }

  if (!projectName.value.trim()) {
    errorMessage.value = "请输入项目名称。";
    return false;
  }

  if (!ownerName.value.trim()) {
    errorMessage.value = "请输入 owner 成员名。";
    return false;
  }

  if (!ownerPassword.value) {
    errorMessage.value = "请输入 owner 密码。";
    return false;
  }

  if (ownerPassword.value !== confirmPassword.value) {
    errorMessage.value = "两次输入的密码不一致。";
    return false;
  }

  if (weightTotal.value !== 100) {
    errorMessage.value = "进度权重总和必须等于 100。";
    return false;
  }

  return true;
}

async function handleCreateProject() {
  message.value = "";
  errorMessage.value = "";

  if (!validateForm() || !locationRoot.value) {
    return;
  }

  isCreating.value = true;

  try {
    const result = await createProjectInDirectory(locationRoot.value, {
      name: projectName.value,
      description: description.value,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
      enableTasks: enableTasks.value,
      enableProofread: enableProofread.value,
      enableReview: enableReview.value,
      requireSignedChangePackages: requireSignedChangePackages.value,
      allowSelfProofread: allowSelfProofread.value,
      allowSelfReview: allowSelfReview.value,
      allowSameUserMultiProofread: allowSameUserMultiProofread.value,
      proofreadRequired: proofreadRequired.value,
      progressWeights: {
        translation: translationWeight.value,
        proofread: proofreadWeight.value,
        review: reviewWeight.value,
      },
      ownerName: ownerName.value,
      ownerPassword: ownerPassword.value,
    });

    emit("created", result.project, result.owner);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "创建项目失败。请确认创建位置可写。";
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <main class="create-project-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">创建项目</p>
        <h1>新建本地汉化项目</h1>
        <p class="summary">
          选择一个空文件夹作为项目根目录，创建后会直接进入项目工作台。
        </p>
      </div>

      <button class="secondary-button" type="button" @click="emit('cancel')">
        返回启动页
      </button>
    </header>

    <p v-if="message" class="message">{{ message }}</p>
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <form class="create-shell" @submit.prevent="handleCreateProject">
      <section class="form-card">
        <h2>基础信息</h2>

        <label>
          <span>项目名称</span>
          <input v-model="projectName" placeholder="例如：短篇视觉小说汉化" />
        </label>

        <label>
          <span>项目简介</span>
          <textarea
            v-model="description"
            rows="4"
            placeholder="写给项目成员看的简短说明"
          />
        </label>

        <div class="field-grid">
          <label>
            <span>源语言</span>
            <input v-model="sourceLanguage" />
          </label>
          <label>
            <span>目标语言</span>
            <input v-model="targetLanguage" />
          </label>
        </div>

        <div class="location-box">
          <div>
            <span>创建位置</span>
            <strong>{{ selectedLocationText }}</strong>
          </div>
          <button
            class="secondary-button"
            type="button"
            :disabled="isSelectingLocation"
            @click="handleSelectLocation"
          >
            {{ isSelectingLocation ? "正在选择..." : "选择文件夹" }}
          </button>
        </div>
      </section>

      <section class="form-card">
        <h2>流程设置</h2>

        <div class="workflow-grid">
          <div class="workflow-column">
            <h3>流程阶段</h3>

            <label class="check-row">
              <input v-model="enableTasks" type="checkbox" />
              <span>启用任务</span>
            </label>

            <label class="check-row">
              <input v-model="enableProofread" type="checkbox" />
              <span>启用校对</span>
            </label>

            <label class="check-row">
              <input v-model="enableReview" type="checkbox" />
              <span>启用审核</span>
            </label>

            <label class="check-row">
              <input v-model="requireSignedChangePackages" type="checkbox" />
              <span>强制签名协作包</span>
            </label>

            <label>
              <span>校对次数</span>
              <select
                v-model.number="proofreadRequired"
                :disabled="!enableProofread"
              >
                <option :value="0">不需要校对</option>
                <option :value="1">一次校对</option>
                <option :value="2">二次校对</option>
                <option :value="3">三次校对</option>
              </select>
            </label>
          </div>

          <div class="workflow-column">
            <h3>人员限制</h3>

            <label class="check-row">
              <input v-model="allowSelfProofread" type="checkbox" />
              <span>允许译者校对自己的译文</span>
            </label>

            <label class="check-row">
              <input v-model="allowSelfReview" type="checkbox" />
              <span>允许审核自己校对的译文</span>
            </label>

            <label class="check-row">
              <input v-model="allowSameUserMultiProofread" type="checkbox" />
              <span>允许同一成员完成多轮校对</span>
            </label>
          </div>
        </div>

        <div class="weights-card">
          <div class="weights-title">
            <span>进度权重</span>
            <strong :class="{ invalid: weightTotal !== 100 }">
              合计 {{ weightTotal }}
            </strong>
          </div>

          <div class="field-grid three">
            <label>
              <span>翻译权重</span>
              <input v-model.number="translationWeight" type="number" min="0" />
            </label>
            <label>
              <span>校对权重</span>
              <input v-model.number="proofreadWeight" type="number" min="0" />
            </label>
            <label>
              <span>审核权重</span>
              <input v-model.number="reviewWeight" type="number" min="0" />
            </label>
          </div>
        </div>
      </section>

      <section class="form-card account-card">
        <h2>负责人账号</h2>

        <label>
          <span>owner 成员名</span>
          <input v-model="ownerName" autocomplete="username" />
        </label>

        <label>
          <span>owner 密码</span>
          <input
            v-model="ownerPassword"
            type="password"
            autocomplete="new-password"
          />
        </label>

        <label>
          <span>确认密码</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
          />
        </label>

        <p class="notice-text">
          密码会以哈希和盐保存到成员文件，不会保存明文密码。
        </p>
      </section>

      <footer class="form-actions">
        <button class="primary-button" type="submit" :disabled="!canCreate">
          {{ isCreating ? "正在创建..." : "创建项目并进入" }}
        </button>
        <button class="secondary-button" type="button" @click="emit('cancel')">
          取消
        </button>
      </footer>
    </form>
  </main>
</template>

<style scoped>
.create-project-page {
  min-height: 100vh;
  padding: 28px;
  background: #eef2f5;
  color: #1f2937;
}

.page-header,
.create-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}

.eyebrow,
h1,
h2,
p {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  color: #5b6472;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  color: #111827;
  font-size: 30px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 19px;
  line-height: 1.25;
}

h3 {
  margin: 0;
  color: #111827;
  font-size: 15px;
  line-height: 1.35;
}

.summary,
.notice-text {
  margin-top: 8px;
  color: #5b6472;
  line-height: 1.6;
}

.message,
.error-message {
  width: min(100%, 1180px);
  margin: 0 auto 14px;
  padding: 10px 12px;
  border-radius: 6px;
  line-height: 1.6;
  background: #ffffff;
}

.message {
  border: 1px solid #b7dfc2;
  color: #166534;
}

.error-message {
  border: 1px solid #f0b8aa;
  color: #b42318;
}

.create-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.75fr);
  gap: 16px;
}

.form-card {
  display: grid;
  align-content: start;
  gap: 15px;
  padding: 20px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.account-card,
.form-actions {
  grid-column: 2;
}

label {
  display: grid;
  gap: 7px;
}

label span,
.location-box span,
.weights-title span {
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

input,
select,
textarea {
  width: 100%;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid #c3ccd8;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
  box-sizing: border-box;
}

textarea {
  min-height: 110px;
  padding: 10px 11px;
  resize: vertical;
  line-height: 1.55;
}

select {
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, #6b7280 50%),
    linear-gradient(135deg, #6b7280 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 17px,
    calc(100% - 11px) 17px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 30px;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

input:disabled,
select:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.workflow-column {
  display: grid;
  align-content: start;
  gap: 13px;
  min-width: 0;
}

.location-box,
.weights-card {
  display: grid;
  gap: 12px;
  padding: 13px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafb;
}

.location-box {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.location-box div,
.weights-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.location-box strong,
.weights-title strong {
  color: #111827;
  font-size: 14px;
}

.weights-title .invalid {
  color: #b42318;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}

.check-row input {
  width: 17px;
  height: 17px;
  min-height: 17px;
  padding: 0;
}

.notice-text {
  padding: 11px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
  font-size: 13px;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  padding: 0 15px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border-color: #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 900px) {
  .create-project-page {
    padding: 18px;
  }

  .page-header,
  .create-shell {
    grid-template-columns: 1fr;
  }

  .page-header {
    display: grid;
  }

  .account-card,
  .form-actions {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .field-grid,
  .field-grid.three,
  .workflow-grid,
  .location-box {
    grid-template-columns: 1fr;
  }

  .form-actions {
    justify-content: flex-start;
  }
}
</style>
