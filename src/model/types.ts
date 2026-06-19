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

export type ProofreadRequired = 0 | 1 | 2 | 3;

export interface ProjectWorkflowSettings {
  enable_tasks?: boolean;
  enable_proofread?: boolean;
  enable_review?: boolean;
  proofread_required?: ProofreadRequired;
  review_required?: boolean;
  allow_self_proofread?: boolean;
  allow_self_review?: boolean;
  allow_same_user_multi_proofread?: boolean;
}

export type TaskStatus =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "submitted"
  | "completed";

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

export type ReleaseExportFormat = "json" | "txt" | "csv" | "ks";

export interface ReleaseExportSettings {
  default_format?: ReleaseExportFormat;
  only_reviewed?: boolean;
  include_source?: boolean;
  include_key?: boolean;
  include_report?: boolean;
  include_manifest?: boolean;
}

export interface ProjectConfig {
  schema_version: number;
  project_id: string;
  name: string;
  description?: string;
  source_language: string;
  target_language: string;
  files: ProjectFile[];
  settings: {
    chunk_size: number;
    auto_save: boolean;
    allow_change_package: boolean;
    workflow?: ProjectWorkflowSettings;
    progress_weights?: {
      translation?: number;
      proofread?: number;
      review?: number;
      translationWeight?: number;
      proofreadWeight?: number;
      reviewWeight?: number;
    };
    export?: ReleaseExportSettings;
  };
}

export interface ProjectFile {
  id: string;
  name: string;
  source_path: string;
  entries_path: string;
  type: string;
  folder?: string;
  hidden: boolean;
  locked: boolean;
  updated_at?: string;
}

export interface Member {
  id: string;
  name: string;
  roles: Role[];
  allow_permissions?: string[];
  deny_permissions?: string[];
  active: boolean;
  public_key?: string;
  key_id?: string;
  key_created_at?: string;
  key_revoked_at?: string;
  password_hash?: string;
  password_salt?: string;
  password_updated_at?: string;
  created_at?: string;
  updated_at?: string;
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
  proofread_count?: number;
  proofread_by?: string[];
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
  description: string;
  file_id: string;
  range_start: number;
  range_end: number;
  entry_ids: string[];
  assignee: string;
  status: TaskStatus;
  target: string;
  submit_method: TaskSubmitMethod;
  proofread_round?: ProofreadRequired;
  created_by: string;
  created_at: string;
  updated_at: string;
  due_at: string;
}

export interface Comment {
  id: string;
  entry_id: string;
  file_id?: string;
  user_id: string;
  body: string;
  reply_to: string | null;
  status?: "open" | "resolved";
  task_id?: string;
  disputed?: boolean;
  resolved?: boolean;
  created_at: string;
  updated_at?: string;
  resolved_at?: string;
  resolved_by?: string;
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

export type ChangePackageType =
  | "user_changes"
  | "task_changes"
  | "maintenance_changes"
  | "legacy";

export interface ChangePackageSummary {
  changed_entries: number;
  changed_comments: number;
  changed_terms: number;
  changed_contexts: number;
  changed_tasks: number;
  changed_members: number;
  changed_project_settings: number;
  changed_credentials: number;
  log_events: number;
}

export interface ChangePackageManifest {
  schema_version: number;
  project_id: string;
  package_id?: string;
  package_type?: ChangePackageType;
  user_id: string;
  user_name?: string;
  task_id?: string;
  created_at: string;
  changed_entries?: number;
  new_comments?: number;
  content_hash?: string;
  app_version?: string;
  source_project_version?: string;
  summary?: ChangePackageSummary;
}

export interface ChangePackageSignature {
  schema_version: number;
  package_id?: string;
  user_id: string;
  content_hash?: string;
  algorithm: string;
  signed_at: string;
  signature: string;
  key_id?: string;
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
  proofread_required?: ProofreadRequired;
  review_required?: boolean;
}
