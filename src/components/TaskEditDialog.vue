<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useAppDraft } from "../composables/useAppDraft";
import type {
  Member,
  ProjectConfig,
  ProofreadRequired,
  Task,
  TaskStatus,
  TaskSubmitMethod,
  TaskType,
} from "../model/types";
import {
  getTaskFileEntryBounds,
  type TaskDraft,
  type TaskFileEntryBounds,
} from "../services/tasks";
import {
  formatDateTimeLocalInput,
  getCurrentTimeZone,
  getSupportedTimeZones,
  getZonedDateTimeCandidates,
  hasExplicitTimeZone,
  zonedDateTimeToUtc,
  type DateTimeDisambiguation,
} from "../utils/time";

const props = defineProps<{
  open: boolean;
  mode: "create" | "edit";
  task?: Task;
  project: ProjectConfig;
  members: Member[];
}>();

const emit = defineEmits<{
  close: [];
  save: [draft: TaskDraft];
}>();

const taskTypes: Array<{ value: TaskType; label: string }> = [
  { value: "translate", label: "翻译" },
  { value: "proofread", label: "校对" },
  { value: "review", label: "审校" },
  { value: "term", label: "术语" },
  { value: "export", label: "导出" },
  { value: "custom", label: "自定义" },
];

const taskStatuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "unassigned", label: "未分配" },
  { value: "assigned", label: "已分配" },
  { value: "in_progress", label: "进行中" },
  { value: "submitted", label: "已提交" },
  { value: "completed", label: "已完成" },
];

const submitMethods: Array<{ value: TaskSubmitMethod; label: string }> = [
  { value: "change_package", label: "导出修改包" },
  { value: "owner_manual", label: "由负责人处理" },
];

const form = reactive({
  title: "",
  description: "",
  type: "translate" as TaskType,
  file_id: "",
  range_start: 1,
  range_end: 1,
  entry_ids_text: "",
  assignee: "",
  status: "unassigned" as TaskStatus,
  target: "",
  proofread_round: 1 as ProofreadRequired,
  submit_method: "change_package" as TaskSubmitMethod,
  due_local: "",
  due_time_zone: getCurrentTimeZone(),
  due_disambiguation: "earlier" as Exclude<DateTimeDisambiguation, "reject">,
});
const timeZoneOptions = getSupportedTimeZones();
const fileEntryBounds = ref<TaskFileEntryBounds>();
const isLoadingFileBounds = ref(false);
const boundsErrorMessage = ref("");
const dueErrorMessage = ref("");
const hasLegacyDueAt = ref(false);
const initialFormSnapshot = ref("");
const isInitializingForm = ref(false);

const proofreadRoundOptions = computed(() => {
  const required = props.project.settings.workflow?.proofread_required ?? 1;
  const maxRound = Math.min(Math.max(required, 1), 3) as ProofreadRequired;

  return [1, 2, 3].filter((round) => round <= maxRound) as ProofreadRequired[];
});
const lastEntryLabel = computed(() => {
  if (!form.file_id) {
    return "未关联文件";
  }

  if (isLoadingFileBounds.value) {
    return "正在读取最后一条...";
  }

  if (boundsErrorMessage.value) {
    return boundsErrorMessage.value;
  }

  if (!fileEntryBounds.value || fileEntryBounds.value.totalEntries === 0) {
    return "暂无词条";
  }

  return `最后一条：${fileEntryBounds.value.lastIndex}`;
});
const canSaveTask = computed(() => {
  if (!form.title.trim()) {
    return false;
  }

  if (props.mode === "edit") {
    return true;
  }

  return !form.file_id || Boolean(fileEntryBounds.value?.lastIndex);
});
const currentFormSnapshot = computed(() => JSON.stringify(form));
const dueCandidates = computed(() => {
  if (!form.due_local || !form.due_time_zone) {
    return [];
  }

  return getZonedDateTimeCandidates(form.due_local, form.due_time_zone);
});
const hasAmbiguousDueAt = computed(() => dueCandidates.value.length > 1);
const hasUnsavedTask = computed(
  () =>
    props.open &&
    Boolean(initialFormSnapshot.value) &&
    currentFormSnapshot.value !== initialFormSnapshot.value,
);

useAppDraft("任务", hasUnsavedTask);

function syncForm() {
  const task = props.task;
  const firstFileId = props.project.files[0]?.id ?? "";

  form.title = task?.title ?? "";
  form.description = task?.description ?? "";
  form.type = task?.type ?? "translate";
  form.file_id = task?.file_id ?? firstFileId;
  form.range_start = task?.range_start ?? 1;
  form.range_end = task?.range_end ?? 1;
  form.entry_ids_text = task?.entry_ids.join("\n") ?? "";
  form.assignee = props.mode === "edit" ? (task?.assignee ?? "") : "";
  form.status =
    props.mode === "edit"
      ? (task?.status ?? (task?.assignee ? "assigned" : "unassigned"))
      : "unassigned";
  form.target = task?.target ?? "";
  form.proofread_round =
    task?.proofread_round ?? proofreadRoundOptions.value[0] ?? 1;
  form.submit_method =
    props.mode === "edit" ? (task?.submit_method ?? "change_package") : "change_package";
  form.due_time_zone = task?.due_time_zone || getCurrentTimeZone();
  hasLegacyDueAt.value = Boolean(
    task?.due_at && !hasExplicitTimeZone(task.due_at),
  );
  form.due_local = task?.due_at
    ? hasLegacyDueAt.value
      ? task.due_at.replace(" ", "T").slice(0, 16)
      : formatDateTimeLocalInput(task.due_at, form.due_time_zone)
    : "";
  form.due_disambiguation = "earlier";
  dueErrorMessage.value = "";
}

async function initializeForm() {
  isInitializingForm.value = true;
  syncForm();
  await refreshFileEntryBounds();
  initialFormSnapshot.value = currentFormSnapshot.value;
  isInitializingForm.value = false;
}

async function refreshFileEntryBounds() {
  const fileId = form.file_id;

  fileEntryBounds.value = undefined;
  boundsErrorMessage.value = "";

  if (!fileId) {
    return;
  }

  isLoadingFileBounds.value = true;

  try {
    const bounds = await getTaskFileEntryBounds(fileId);

    if (form.file_id !== fileId) {
      return;
    }

    fileEntryBounds.value = bounds;

    if (props.mode === "create" && bounds.lastIndex > 0) {
      form.range_start = bounds.firstIndex || 1;
      form.range_end = bounds.lastIndex;
    }
  } catch {
    if (form.file_id === fileId) {
      boundsErrorMessage.value = "无法读取最后一条";
    }
  } finally {
    if (form.file_id === fileId) {
      isLoadingFileBounds.value = false;
    }
  }
}

function handleSubmit() {
  const title = form.title.trim();

  if (!title || !canSaveTask.value) {
    return;
  }

  let dueAt = "";

  dueErrorMessage.value = "";

  try {
    dueAt = form.due_local
      ? zonedDateTimeToUtc(
          form.due_local,
          form.due_time_zone,
          hasAmbiguousDueAt.value ? form.due_disambiguation : "reject",
        )
      : "";
  } catch (error) {
    dueErrorMessage.value =
      error instanceof Error ? error.message : "截止时间无效。";
    return;
  }

  emit("save", {
    title,
    description: form.description.trim(),
    type: form.type,
    file_id: form.file_id,
    range_start: Number(form.range_start) || 1,
    range_end: Number(form.range_end) || Number(form.range_start) || 1,
    entry_ids: form.entry_ids_text
      .split(/[\n,，\s]+/)
      .map((id) => id.trim())
      .filter(Boolean),
    assignee: props.mode === "edit" ? form.assignee : "",
    status: props.mode === "edit" ? form.status : undefined,
    target: form.target.trim(),
    proofread_round:
      form.type === "proofread" ? form.proofread_round : undefined,
    submit_method: props.mode === "edit" ? form.submit_method : "change_package",
    due_at: dueAt,
    due_time_zone: dueAt ? form.due_time_zone : undefined,
  });
}

watch(
  () => [props.open, props.task?.id, props.project.project_id],
  () => {
    if (props.open) {
      void initializeForm();
    }
  },
  { immediate: true },
);

watch(
  () => form.file_id,
  () => {
    if (props.open && !isInitializingForm.value) {
      void refreshFileEntryBounds();
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" role="presentation">
      <form class="task-dialog" @submit.prevent="handleSubmit">
        <header class="dialog-header">
          <div>
            <p class="eyebrow">{{ mode === "create" ? "创建任务" : "编辑任务" }}</p>
            <h2>{{ mode === "create" ? "新任务" : task?.title }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
            ×
          </button>
        </header>

        <label class="wide-field">
          <span>标题</span>
          <input v-model="form.title" required maxlength="80" />
        </label>

        <label class="wide-field">
          <span>说明</span>
          <textarea v-model="form.description" rows="2" />
        </label>

        <div class="field-grid">
          <label>
            <span>类型</span>
            <select v-model="form.type">
              <option v-for="item in taskTypes" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>

          <label v-if="mode === 'edit'">
            <span>状态</span>
            <select v-model="form.status">
              <option v-for="item in taskStatuses" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>

          <label>
            <span>文件</span>
            <select v-model="form.file_id">
              <option value="">不关联文件</option>
              <option v-for="file in project.files" :key="file.id" :value="file.id">
                {{ file.name }}
              </option>
            </select>
          </label>

          <label v-if="mode === 'edit'">
            <span>成员</span>
            <select v-model="form.assignee">
              <option value="">未分配</option>
              <option
                v-for="member in members.filter((item) => item.active)"
                :key="member.id"
                :value="member.id"
              >
                {{ member.name }}
              </option>
            </select>
          </label>

          <label>
            <span>起始词条</span>
            <input v-model.number="form.range_start" min="1" type="number" />
          </label>

          <label>
            <span class="range-label">
              <span>结束词条</span>
              <small>{{ lastEntryLabel }}</small>
            </span>
            <input
              v-model.number="form.range_end"
              min="1"
              type="number"
              :max="fileEntryBounds?.lastIndex || undefined"
            />
          </label>

          <label v-if="form.type === 'proofread'">
            <span>校对轮次</span>
            <select v-model.number="form.proofread_round">
              <option v-for="round in proofreadRoundOptions" :key="round" :value="round">
                第 {{ round }} 轮
              </option>
            </select>
          </label>

          <label v-if="mode === 'edit'">
            <span>提交方式</span>
            <select v-model="form.submit_method">
              <option v-for="item in submitMethods" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>

          <label>
            <span>截止时间</span>
            <input v-model="form.due_local" type="datetime-local" />
          </label>

          <label>
            <span>截止时区</span>
            <input
              v-model.trim="form.due_time_zone"
              list="task-time-zone-options"
              placeholder="例如 Asia/Tokyo"
            />
            <datalist id="task-time-zone-options">
              <option
                v-for="timeZone in timeZoneOptions"
                :key="timeZone"
                :value="timeZone"
              />
            </datalist>
          </label>

          <label v-if="hasAmbiguousDueAt">
            <span>重复时刻</span>
            <select v-model="form.due_disambiguation">
              <option value="earlier">较早时刻</option>
              <option value="later">较晚时刻</option>
            </select>
          </label>

          <label>
            <span>目标</span>
            <input v-model="form.target" placeholder="例如：完成第 1-20 条翻译" />
          </label>
        </div>

        <p v-if="hasLegacyDueAt" class="time-warning">
          旧任务未记录截止时区。保存时将按上方时区转换为 UTC。
        </p>
        <p v-if="dueErrorMessage" class="error-message">{{ dueErrorMessage }}</p>

        <label class="wide-field">
          <span>指定词条编号</span>
          <textarea
            v-model="form.entry_ids_text"
            rows="2"
            placeholder="每行一个词条编号；留空时使用文件范围"
          />
        </label>

        <footer class="dialog-actions">
          <button class="secondary-button" type="button" @click="emit('close')">
            取消
          </button>
          <button class="primary-button" type="submit" :disabled="!canSaveTask">
            保存
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(17, 24, 39, 0.42);
}

.task-dialog {
  display: grid;
  gap: 10px;
  width: min(760px, 100%);
  max-height: min(860px, calc(100vh - 24px));
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  background: #ffffff;
  color: #172033;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

.dialog-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow,
h2 {
  margin: 0;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
}

h2 {
  margin-top: 3px;
  font-size: 20px;
  line-height: 1.25;
}

.icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid #ccd4df;
  border-radius: 6px;
  background: #ffffff;
  color: #344054;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 4px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

.range-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.range-label small {
  color: #2f6f73;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.wide-field {
  grid-column: 1 / -1;
}

input,
select,
textarea {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  font: inherit;
}

textarea {
  min-height: 68px;
  resize: vertical;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.time-warning,
.error-message {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.time-warning {
  border: 1px solid #f0d59c;
  background: #fffbeb;
  color: #8a4b08;
}

.error-message {
  border: 1px solid #f4c7c3;
  background: #fff7f6;
  color: #b42318;
}

.primary-button,
.secondary-button {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2f6f73;
  color: #ffffff;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.secondary-button {
  border: 1px solid #ccd4df;
  background: #ffffff;
  color: #172033;
}

@media (max-width: 720px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
