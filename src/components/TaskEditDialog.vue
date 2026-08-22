<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useAppDraft } from "../composables/useAppDraft";
import { buildMemberOptions } from "../model/memberOptions";
import { TASK_TYPE_OPTIONS } from "../model/taskPresentation";
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
  getTaskFilesEntrySummary,
  resolveTaskRangeEntryIds,
  type TaskDraft,
  type TaskFileEntryProgress,
  type TaskFilesEntrySummary,
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

const taskStatuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "unassigned", label: "未分配" },
  { value: "assigned", label: "已分配" },
  { value: "in_progress", label: "进行中" },
  { value: "submitted", label: "已提交" },
  { value: "completed", label: "已完成" },
];

const form = reactive({
  title: "",
  description: "",
  type: "translate" as TaskType,
  file_id: "",
  file_ids: [] as string[],
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
const allFilesEntrySummary = ref<TaskFilesEntrySummary>();
const isLoadingFileSummary = ref(false);
const fileSearch = ref("");
const showIncompleteOnly = ref(false);
const boundsErrorMessage = ref("");
const scopeErrorMessage = ref("");
const dueErrorMessage = ref("");
const hasLegacyDueAt = ref(false);
const initialFormSnapshot = ref("");
const isInitializingForm = ref(false);
const assignmentOptions = computed(() =>
  buildMemberOptions(
    props.members,
    props.task?.assignee ? [props.task.assignee] : [],
  ),
);

const proofreadRoundOptions = computed(() => {
  const required = props.project.settings.workflow?.proofread_required ?? 1;
  const maxRound = Math.min(Math.max(required, 1), 3) as ProofreadRequired;

  return [1, 2, 3].filter((round) => round <= maxRound) as ProofreadRequired[];
});
const selectedFileIds = computed(() => {
  const selected = new Set(form.file_ids);
  return props.project.files
    .map((file) => file.id)
    .filter((fileId) => selected.has(fileId));
});
const fileProgressById = computed(
  () => new Map(
    (allFilesEntrySummary.value?.files ?? []).map((file) => [file.fileId, file]),
  ),
);
const filesEntrySummary = computed<TaskFilesEntrySummary | undefined>(() => {
  if (!allFilesEntrySummary.value) {
    return undefined;
  }

  const files = selectedFileIds.value
    .map((fileId) => fileProgressById.value.get(fileId))
    .filter((file): file is TaskFileEntryProgress => Boolean(file));

  return {
    fileCount: files.length,
    totalEntries: files.reduce((total, file) => total + file.totalEntries, 0),
    files,
  };
});
const visibleFiles = computed(() => {
  const query = fileSearch.value.trim().toLocaleLowerCase();
  const selected = new Set(form.file_ids);

  return props.project.files.filter((file) => {
    if (query && !file.name.toLocaleLowerCase().includes(query)) {
      return false;
    }

    if (!showIncompleteOnly.value || selected.has(file.id)) {
      return true;
    }

    const progress = fileProgressById.value.get(file.id);
    return !progress?.progressAvailable || progress.completedEntries < progress.totalEntries;
  });
});
const selectedFilesLabel = computed(() => {
  if (form.file_ids.length === 0) {
    return "未选择文件";
  }

  if (isLoadingFileSummary.value) {
    return `已选 ${form.file_ids.length} 个文件，正在统计...`;
  }

  if (boundsErrorMessage.value) {
    return boundsErrorMessage.value;
  }

  const summary = filesEntrySummary.value;

  if (!summary || summary.totalEntries === 0) {
    return `已选 ${form.file_ids.length} 个文件，共 0 条`;
  }

  const pendingEntries = summary.files.reduce(
    (total, file) => total + Math.max(0, file.totalEntries - file.completedEntries),
    0,
  );
  const pendingLabel = summary.files.every((file) => file.progressAvailable)
    ? `，待处理 ${pendingEntries} 条`
    : "";

  return `已选 ${summary.fileCount} 个文件，共 ${summary.totalEntries} 条${pendingLabel}`;
});
const explicitEntryIds = computed(() =>
  form.entry_ids_text
    .split(/[\n,，\s]+/)
    .map((id) => id.trim())
    .filter(Boolean),
);
const canSaveTask = computed(() => {
  if (!form.title.trim()) {
    return false;
  }

  if (explicitEntryIds.value.length > 0) {
    return true;
  }

  if (form.file_ids.length === 0) {
    return form.type === "term" || form.type === "custom";
  }

  return Boolean(filesEntrySummary.value?.totalEntries);
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

  form.title = task?.title ?? "";
  form.description = task?.description ?? "";
  form.type = task?.type ?? "translate";
  form.file_id = task?.file_id ?? "";
  form.file_ids = task?.file_ids ?? (task?.file_id ? [task.file_id] : []);
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
  fileSearch.value = "";
  showIncompleteOnly.value = false;
  dueErrorMessage.value = "";
}

async function initializeForm() {
  isInitializingForm.value = true;
  syncForm();
  await refreshFilesEntrySummary();
  if (
    props.mode === "create" ||
    (props.task?.file_ids?.length && props.task.entry_ids.length === 0)
  ) {
    setFullSelectedRange();
  }
  initialFormSnapshot.value = currentFormSnapshot.value;
  isInitializingForm.value = false;
}

function setFullSelectedRange() {
  const totalEntries = filesEntrySummary.value?.totalEntries ?? 0;

  if (totalEntries > 0) {
    form.range_start = 1;
    form.range_end = totalEntries;
  }
}

let fileSummaryRequestId = 0;

async function refreshFilesEntrySummary() {
  const requestId = ++fileSummaryRequestId;
  const fileIds = props.project.files.map((file) => file.id);
  const workflow = form.type === "proofread"
    ? {
        ...props.project.settings.workflow,
        proofread_required: form.proofread_round,
      }
    : props.project.settings.workflow;

  allFilesEntrySummary.value = undefined;
  boundsErrorMessage.value = "";

  if (fileIds.length === 0) {
    return;
  }

  isLoadingFileSummary.value = true;

  try {
    const summary = await getTaskFilesEntrySummary(fileIds, form.type, workflow);

    if (requestId !== fileSummaryRequestId) {
      return;
    }

    allFilesEntrySummary.value = summary;
  } catch {
    if (requestId === fileSummaryRequestId) {
      boundsErrorMessage.value = "无法读取文件词条进度";
    }
  } finally {
    if (requestId === fileSummaryRequestId) {
      isLoadingFileSummary.value = false;
    }
  }
}

function getFileProgressLabel(progress?: TaskFileEntryProgress): string {
  if (!progress) {
    return isLoadingFileSummary.value ? "正在统计..." : "无法读取进度";
  }

  if (!progress.progressAvailable) {
    return `共 ${progress.totalEntries} 条`;
  }

  const typeLabel = form.type === "translate"
    ? "已翻译"
    : form.type === "proofread"
      ? `第 ${form.proofread_round} 轮完成`
      : "已审核";

  return `${typeLabel} ${progress.completedEntries}/${progress.totalEntries} · ${progress.progressPercent}%`;
}

async function handleSubmit() {
  const title = form.title.trim();

  if (!title || !canSaveTask.value) {
    return;
  }

  let dueAt = "";
  let entryIds = explicitEntryIds.value;

  dueErrorMessage.value = "";
  scopeErrorMessage.value = "";

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

  const totalEntries = filesEntrySummary.value?.totalEntries ?? 0;
  const rangeStart =
    totalEntries > 0
      ? Math.min(totalEntries, Math.max(1, Number(form.range_start) || 1))
      : 1;
  const rangeEnd = Math.min(
    totalEntries,
    Math.max(rangeStart, Number(form.range_end) || rangeStart),
  );

  if (
    entryIds.length === 0 &&
    selectedFileIds.value.length > 0 &&
    totalEntries > 0 &&
    (rangeStart !== 1 || rangeEnd !== totalEntries)
  ) {
    try {
      entryIds = await resolveTaskRangeEntryIds(
        selectedFileIds.value,
        rangeStart,
        rangeEnd,
      );
      if (entryIds.length === 0) {
        scopeErrorMessage.value = "所选范围内没有词条，请调整起止词条。";
        return;
      }
    } catch {
      scopeErrorMessage.value = "无法解析所选文件范围，请重新选择后再试。";
      return;
    }
  }

  emit("save", {
    title,
    description: form.description.trim(),
    type: form.type,
    file_id: selectedFileIds.value.length === 1 ? selectedFileIds.value[0] : "",
    file_ids: selectedFileIds.value,
    range_start: rangeStart,
    range_end: rangeEnd || rangeStart,
    entry_ids: entryIds,
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
  () => form.file_ids,
  () => {
    form.file_id = selectedFileIds.value.length === 1 ? selectedFileIds.value[0] : "";
    if (props.open && !isInitializingForm.value) {
      setFullSelectedRange();
    }
  },
  { deep: true },
);

watch(
  () => [form.type, form.proofread_round],
  () => {
    if (props.open && !isInitializingForm.value) {
      void refreshFilesEntrySummary();
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
              <option v-for="item in TASK_TYPE_OPTIONS" :key="item.value" :value="item.value">
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

          <fieldset class="file-field wide-field">
            <legend>
              <span>文件</span>
              <small>{{ selectedFilesLabel }}</small>
            </legend>
            <div class="file-tools">
              <input
                v-model="fileSearch"
                type="search"
                placeholder="搜索文件名"
                aria-label="搜索文件名"
              />
              <label class="incomplete-filter">
                <input v-model="showIncompleteOnly" type="checkbox" />
                <span>只看未完成</span>
              </label>
            </div>
            <div class="file-options">
              <label v-for="file in visibleFiles" :key="file.id" class="file-option">
                <input v-model="form.file_ids" type="checkbox" :value="file.id" />
                <span class="file-option-content">
                  <span class="file-name">{{ file.name }}</span>
                  <small>{{ getFileProgressLabel(fileProgressById.get(file.id)) }}</small>
                  <span
                    v-if="fileProgressById.get(file.id)?.progressAvailable"
                    class="file-progress-track"
                    aria-hidden="true"
                  >
                    <span
                      :style="{
                        width: `${fileProgressById.get(file.id)?.progressPercent ?? 0}%`,
                      }"
                    ></span>
                  </span>
                </span>
              </label>
              <p v-if="visibleFiles.length === 0" class="empty-file-result">
                没有符合条件的文件
              </p>
            </div>
            <small
              v-if="
                form.file_ids.length === 0 &&
                explicitEntryIds.length === 0 &&
                form.type !== 'term' &&
                form.type !== 'custom'
              "
              class="file-scope-hint"
            >
              请选择至少一个文件，或在下方指定词条编号。
            </small>
          </fieldset>

          <label v-if="mode === 'edit'">
            <span>成员</span>
            <select v-model="form.assignee">
              <option value="">未分配</option>
              <option
                v-for="member in assignmentOptions"
                :key="member.id"
                :value="member.id"
                :disabled="!member.active"
              >
                {{ member.label }}
              </option>
            </select>
          </label>

          <label>
            <span>起始词条</span>
            <input
              v-model.number="form.range_start"
              min="1"
              type="number"
              :max="filesEntrySummary?.totalEntries || undefined"
              :disabled="explicitEntryIds.length > 0"
            />
          </label>

          <label>
            <span>结束词条</span>
            <input
              v-model.number="form.range_end"
              min="1"
              type="number"
              :max="filesEntrySummary?.totalEntries || undefined"
              :disabled="explicitEntryIds.length > 0"
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

        </div>

        <p v-if="hasLegacyDueAt" class="time-warning">
          旧任务未记录截止时区。保存时将按上方时区转换为 UTC。
        </p>
        <p v-if="dueErrorMessage" class="error-message">{{ dueErrorMessage }}</p>
        <p v-if="scopeErrorMessage" class="error-message">{{ scopeErrorMessage }}</p>

        <label class="wide-field">
          <span>指定词条编号</span>
          <textarea
            v-model="form.entry_ids_text"
            rows="2"
            placeholder="每行一个词条编号；留空时使用文件范围"
          />
          <small>填写后将优先使用这些词条编号，起止范围暂不生效。</small>
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
  font-size: 18px;
  line-height: 1.3;
}

.icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid #ccd4df;
  border-radius: 6px;
  background: #ffffff;
  color: #344054;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: start;
}

label {
  display: grid;
  gap: 4px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

.file-field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.file-field legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  margin-bottom: 4px;
  padding: 0;
}

.file-field legend small {
  color: #2f6f73;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.file-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 6px;
}

.file-tools input[type="search"] {
  height: 34px;
  min-height: 34px;
}

.incomplete-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid #ccd4df;
  border-radius: 6px;
  background: #ffffff;
}

.incomplete-filter input {
  width: 15px;
  height: 15px;
  margin: 0;
}

.file-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 4px 12px;
  height: 220px;
  padding: 8px 10px;
  overflow: auto;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
}

.file-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 52px;
  padding: 3px 0;
}

.file-option input {
  width: 16px;
  height: 16px;
  min-height: 0;
  margin: 0;
}

.file-option-content {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.file-option .file-name {
  overflow: hidden;
  color: #172033;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-option-content small {
  overflow: hidden;
  color: #667085;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-option .file-progress-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: #e8edf2;
}

.file-option .file-progress-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f6f73;
}

.empty-file-result {
  grid-column: 1 / -1;
  margin: 12px 0;
  color: #667085;
  font-size: 13px;
  text-align: center;
}

.file-scope-hint {
  display: block;
  margin-top: 5px;
  color: #8a4b08;
  font-size: 12px;
}

.wide-field {
  grid-column: 1 / -1;
}

input:not([type="checkbox"]),
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

input:not([type="checkbox"]),
select {
  height: 40px;
}

input:disabled {
  background: #f2f4f7;
  color: #7a8493;
}

.wide-field small {
  color: #5b6472;
  font-size: 12px;
  line-height: 1.45;
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

  .file-options {
    grid-template-columns: 1fr;
  }

  .file-tools {
    grid-template-columns: 1fr;
  }

  .incomplete-filter {
    justify-self: start;
  }
}
</style>
