import type {
  ProjectCollaborationSettings,
  ProjectConfig,
} from "../model/types";

export const DEFAULT_COLLABORATION_SETTINGS: Required<ProjectCollaborationSettings> = {
  require_signed_change_packages: false,
};

export const DEFAULT_NEW_PROJECT_COLLABORATION_SETTINGS: Required<ProjectCollaborationSettings> = {
  require_signed_change_packages: true,
};

export function normalizeProjectCollaborationSettings(
  settings: ProjectCollaborationSettings | null | undefined,
): Required<ProjectCollaborationSettings> {
  return {
    require_signed_change_packages:
      settings?.require_signed_change_packages ??
      DEFAULT_COLLABORATION_SETTINGS.require_signed_change_packages,
  };
}

export function projectRequiresSignedChangePackages(
  project: ProjectConfig | null | undefined,
): boolean {
  return normalizeProjectCollaborationSettings(
    project?.settings.collaboration,
  ).require_signed_change_packages;
}
