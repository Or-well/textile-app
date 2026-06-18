export type Role =
  | "admin"
  | "owner"
  | "tech_lead"
  | "translator"
  | "proofreader"
  | "reviewer"
  | "publisher"
  | "term_manager"
  | "readonly";

export type EntryStatus =
  | "untranslated"
  | "translated"
  | "proofread"
  | "reviewed";

export type TaskStatus =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "submitted"
  | "completed"
  | "reclaimed"
  | "blocked";

export type TaskType =
  | "translate"
  | "proofread"
  | "review"
  | "term"
  | "export"
  | "custom";

export type TaskSubmitMethod =
  | "change_package"
  | "git_hidden"
  | "git_manual";

export interface ProjectConfig {
  schema_version: number;
  project_id: string;
  name: string;
  source_language: string;
  target_language: string;
  files: ProjectFile[];
  settings: {
    chunk_size: number;
    auto_save: boolean;
    allow_change_package: boolean;
    progress_weights?: {
      translation?: number;
      proofread?: number;
      review?: number;
      translationWeight?: number;
      proofreadWeight?: number;
      reviewWeight?: number;
    };
  };
}

export interface ProjectFile {
  id: string;
  name: string;
  source_path: string;
  entries_path: string;
  type: string;
  hidden: boolean;
  locked: boolean;
}

export interface Member {
  id: string;
  name: string;
  roles: Role[];
  allow_permissions?: string[];
  deny_permissions?: string[];
  active: boolean;
}

export interface Entry {
  id: string;
  file_id: string;
  index: number;
  key: string;
  speaker: string;
  source: string;
  target: string;
  context?: string;
  status: EntryStatus;
  disputed?: boolean;
  dispute_reason?: string;
  dispute_resolved_at?: string;
  dispute_resolved_by?: string;
  assignee: string;
  translated_by: string;
  proofread_by: string;
  reviewed_by: string;
  word_count: number;
  hidden: boolean;
  locked: boolean;
  updated_at: string;
  updated_by: string;
}

export interface Term {
  id: string;
  source: string;
  target: string;
  part_of_speech: string;
  note: string;
  variants: string[];
  case_sensitive?: boolean;
  created_by: string;
  created_at?: string;
  updated_at: string;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  file_id: string;
  range_start: number;
  range_end: number;
  entry_ids: string[];
  assignee: string;
  status: TaskStatus;
  submit_method: TaskSubmitMethod;
  created_by: string;
  created_at: string;
  due_at: string;
}

export interface Comment {
  id: string;
  entry_id: string;
  user_id: string;
  created_at: string;
  body: string;
  reply_to: string | null;
  task_id?: string;
  disputed?: boolean;
  resolved?: boolean;
  updated_at?: string;
}

export interface ProjectEvent {
  id: string;
  type: string;
  user_id: string;
  created_at: string;
  entry_id?: string;
  task_id?: string;
  file_id?: string;
  detail?: Record<string, unknown>;
}

export interface ChangePackageManifest {
  schema_version: number;
  project_id: string;
  user_id: string;
  user_name: string;
  task_id: string;
  created_at: string;
  changed_entries: number;
  new_comments: number;
}

export interface ProjectStats {
  total_entries: number;
  untranslated_entries: number;
  translated_entries: number;
  proofread_entries: number;
  reviewed_entries: number;
  disputed_entries: number;
  total_tasks: number;
  tasks_by_status: Record<TaskStatus, number>;
  progress_percent: number;
}
