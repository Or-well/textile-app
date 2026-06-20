import type {
  Entry,
  Member,
  ProjectConfig,
  Role,
} from "../../src/model/types";

export function createEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry-1",
    file_id: "file-1",
    index: 0,
    key: "line.1",
    speaker: "",
    source: "Source",
    target: "",
    status: "untranslated",
    assignee: "",
    translated_by: "",
    proofread_count: 0,
    proofread_by: [],
    reviewed_by: "",
    word_count: 1,
    hidden: false,
    locked: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "member-1",
    ...overrides,
  };
}

export function createMember(
  roles: Role[],
  overrides: Partial<Member> = {},
): Member {
  return {
    id: "member-1",
    name: "Member",
    roles,
    active: true,
    ...overrides,
  };
}

export function createProject(
  overrides: Partial<ProjectConfig> = {},
): ProjectConfig {
  const base: ProjectConfig = {
    schema_version: 1,
    project_id: "project-1",
    name: "Project",
    source_language: "en",
    target_language: "zh-CN",
    files: [],
    settings: {
      chunk_size: 500,
      auto_save: true,
      allow_change_package: true,
    },
  };

  return {
    ...base,
    ...overrides,
    settings: {
      ...base.settings,
      ...overrides.settings,
    },
  };
}
