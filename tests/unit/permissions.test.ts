import { describe, expect, it } from "vitest";
import {
  OWNER_LOCKED_PERMISSIONS,
  PERMISSION_ACTIONS,
} from "../../src/model/permissions";
import {
  can,
  canEditEntry,
  canProofreadEntry,
  canReviewEntry,
  canTranslateEntry,
  getDefaultRolePermissions,
  getEffectivePermissions,
  validateRolePermissionChange,
} from "../../src/services/permissions";
import { createEntry, createMember, createProject } from "./factories";

describe("effective permissions", () => {
  it("rejects missing and inactive members", () => {
    expect(can(null, PERMISSION_ACTIONS.PROJECT_READ)).toBe(false);
    expect(
      can(
        createMember(["owner"], { active: false }),
        PERMISSION_ACTIONS.PROJECT_MANAGE,
      ),
    ).toBe(false);
  });

  it("uses default role permissions", () => {
    const translator = createMember(["translator"]);

    expect(can(translator, PERMISSION_ACTIONS.ENTRY_TRANSLATE)).toBe(true);
    expect(can(translator, PERMISSION_ACTIONS.ENTRY_REVIEW)).toBe(false);
  });

  it("applies explicit allows and gives denies precedence", () => {
    const allowed = createMember(["readonly"], {
      allow_permissions: [PERMISSION_ACTIONS.ENTRY_EDIT],
    });
    const denied = createMember(["translator"], {
      allow_permissions: [PERMISSION_ACTIONS.ENTRY_REVIEW],
      deny_permissions: [
        PERMISSION_ACTIONS.ENTRY_TRANSLATE,
        PERMISSION_ACTIONS.ENTRY_REVIEW,
      ],
    });

    expect(getEffectivePermissions(allowed)).toContain(
      PERMISSION_ACTIONS.ENTRY_EDIT,
    );
    expect(can(denied, PERMISSION_ACTIONS.ENTRY_TRANSLATE)).toBe(false);
    expect(can(denied, PERMISSION_ACTIONS.ENTRY_REVIEW)).toBe(false);
  });

  it("restores system-locked owner permissions after overrides", () => {
    const owner = createMember(["owner"], {
      deny_permissions: [...OWNER_LOCKED_PERMISSIONS],
    });
    const permissions = getEffectivePermissions(owner);

    for (const permission of OWNER_LOCKED_PERMISSIONS) {
      expect(permissions).toContain(permission);
    }
  });

  it("rejects role configurations that remove owner safety permissions", () => {
    const project = createProject();
    const permissions = getDefaultRolePermissions();

    permissions.owner = permissions.owner?.filter(
      (permission) => permission !== PERMISSION_ACTIONS.PROJECT_MANAGE,
    );

    expect(() =>
      validateRolePermissionChange(project, permissions),
    ).toThrow("项目负责人关键权限不能取消。");
  });
});

describe("entry workflow permissions", () => {
  it("blocks editing and translating locked, hidden, or reviewed entries", () => {
    const translator = createMember(["translator"]);

    expect(canEditEntry(translator, createEntry({ locked: true }))).toBe(false);
    expect(canEditEntry(translator, createEntry({ hidden: true }))).toBe(false);
    expect(
      canTranslateEntry(
        translator,
        createEntry({ target: "Done", status: "reviewed" }),
      ),
    ).toBe(false);
  });

  it("enforces proofread workflow and self-proofread rules", () => {
    const proofreader = createMember(["proofreader"], {
      id: "proofreader-1",
    });
    const entry = createEntry({
      target: "Translated",
      status: "translated",
      translated_by: "translator-1",
    });

    expect(
      canProofreadEntry(proofreader, entry, { proofread_required: 2 }),
    ).toBe(true);
    expect(
      canProofreadEntry(
        proofreader,
        { ...entry, translated_by: proofreader.id },
        { proofread_required: 2, allow_self_proofread: false },
      ),
    ).toBe(false);
    expect(
      canProofreadEntry(
        proofreader,
        { ...entry, proofread_by: [proofreader.id], proofread_count: 1 },
        {
          proofread_required: 2,
          allow_same_user_multi_proofread: false,
        },
      ),
    ).toBe(false);
    expect(
      canProofreadEntry(
        proofreader,
        { ...entry, disputed: true },
        { proofread_required: 2 },
      ),
    ).toBe(false);
  });

  it("requires completed proofread and a separate reviewer when configured", () => {
    const reviewer = createMember(["reviewer"], { id: "reviewer-1" });
    const entry = createEntry({
      target: "Translated",
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
    });

    expect(
      canReviewEntry(reviewer, entry, {
        proofread_required: 1,
        review_required: true,
      }),
    ).toBe(true);
    expect(
      canReviewEntry(
        reviewer,
        { ...entry, proofread_count: 0, proofread_by: [] },
        { proofread_required: 1, review_required: true },
      ),
    ).toBe(false);
    expect(
      canReviewEntry(
        reviewer,
        { ...entry, translated_by: reviewer.id },
        {
          proofread_required: 1,
          review_required: true,
          allow_self_review: false,
        },
      ),
    ).toBe(false);
    expect(
      canReviewEntry(reviewer, entry, {
        proofread_required: 1,
        review_required: false,
      }),
    ).toBe(false);
  });
});
