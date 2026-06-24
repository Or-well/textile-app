import { describe, expect, it } from "vitest";
import {
  OWNER_LOCKED_PERMISSIONS,
  PERMISSION_ACTIONS,
} from "../../src/model/permissions";
import {
  can,
  canEditEntry,
  canProofreadEntry,
  canResolveDispute,
  canReviewEntry,
  canRestoreEntryVersion,
  canTranslateEntry,
  getDefaultRolePermissions,
  getEffectivePermissions,
  getProofreadBlockMessage,
  getProofreadBlockReason,
  getReviewBlockMessage,
  getReviewBlockReason,
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
    const proofreader = createMember(["proofreader"]);
    const reviewer = createMember(["reviewer"]);

    expect(can(translator, PERMISSION_ACTIONS.ENTRY_TRANSLATE)).toBe(true);
    expect(can(translator, PERMISSION_ACTIONS.ENTRY_PROOFREAD)).toBe(false);
    expect(can(translator, PERMISSION_ACTIONS.ENTRY_REVIEW)).toBe(false);
    expect(can(proofreader, PERMISSION_ACTIONS.ENTRY_PROOFREAD)).toBe(true);
    expect(can(proofreader, PERMISSION_ACTIONS.ENTRY_TRANSLATE)).toBe(false);
    expect(can(proofreader, PERMISSION_ACTIONS.ENTRY_REVIEW)).toBe(false);
    expect(can(reviewer, PERMISSION_ACTIONS.ENTRY_REVIEW)).toBe(true);
    expect(can(reviewer, PERMISSION_ACTIONS.ENTRY_TRANSLATE)).toBe(false);
    expect(can(reviewer, PERMISSION_ACTIONS.ENTRY_PROOFREAD)).toBe(false);

    for (const member of [translator, proofreader, reviewer]) {
      expect(
        canResolveDispute(member, createEntry({ disputed: true })),
      ).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.CONTEXT_CREATE)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.CONTEXT_UPDATE)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.CONTEXT_DELETE)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.COMMENT_CREATE)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.COMMENT_REPLY)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.COMMENT_RESOLVE)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.COMMENT_REOPEN)).toBe(true);
      expect(can(member, PERMISSION_ACTIONS.COMMENT_DELETE_OWN)).toBe(true);
    }
  });

  it("adds entry management defaults only for legacy permission configs", () => {
    const owner = createMember(["owner"]);
    const legacyProject = createProject({
      settings: {
        role_permissions: {
          owner: [PERMISSION_ACTIONS.PROJECT_MANAGE],
        },
      },
    });
    const currentProject = createProject({
      settings: {
        role_permissions: {
          owner: [
            PERMISSION_ACTIONS.PROJECT_MANAGE,
            PERMISSION_ACTIONS.MEMBER_MANAGE,
            PERMISSION_ACTIONS.ROLE_MANAGE,
            PERMISSION_ACTIONS.PROJECT_BACKUP,
          ],
        },
        permission_schema_version: 2,
      },
    });

    expect(can(owner, PERMISSION_ACTIONS.ENTRY_LOCK, legacyProject)).toBe(true);
    expect(can(owner, PERMISSION_ACTIONS.ENTRY_LOCK, currentProject)).toBe(false);
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
    expect(
      canRestoreEntryVersion(translator, createEntry({ locked: true })),
    ).toBe(false);
    expect(
      canRestoreEntryVersion(translator, createEntry({ hidden: true })),
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

  it("explains why a proofreader is blocked", () => {
    const proofreader = createMember(["proofreader"], {
      id: "proofreader-1",
    });
    const selfTranslatedEntry = createEntry({
      target: "Translated",
      status: "translated",
      translated_by: proofreader.id,
    });
    const reason = getProofreadBlockReason(
      proofreader,
      selfTranslatedEntry,
      {
        proofread_required: 1,
        allow_self_proofread: false,
      },
    );

    expect(reason).toBe("self_proofread_disabled");
    expect(getProofreadBlockMessage(reason)).toBe(
      "当前用户被记录为该译文的译者，项目未允许校对自己的译文。",
    );
    expect(
      getProofreadBlockReason(
        proofreader,
        { ...selfTranslatedEntry, translated_by: "translator-1" },
        { proofread_required: 1 },
      ),
    ).toBeNull();
  });

  it("requires completed proofread and blocks only the current round first proofreader", () => {
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
    ).toBe(true);
    expect(
      canReviewEntry(
        reviewer,
        {
          ...entry,
          proofread_by: ["proofreader-1", reviewer.id],
          proofread_count: 2,
        },
        {
          proofread_required: 2,
          review_required: true,
          allow_self_review: false,
        },
      ),
    ).toBe(true);
    expect(
      canReviewEntry(
        reviewer,
        {
          ...entry,
          proofread_by: [reviewer.id, "proofreader-2"],
          proofread_count: 2,
        },
        {
          proofread_required: 2,
          review_required: true,
          allow_self_review: false,
        },
      ),
    ).toBe(false);
    expect(
      canReviewEntry(
        reviewer,
        {
          ...entry,
          proofread_by: [reviewer.id, "proofreader-2", reviewer.id],
          proofread_count: 3,
        },
        {
          proofread_required: 3,
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

  it("explains when the current round first proofreader cannot review", () => {
    const reviewer = createMember(["reviewer"], { id: "reviewer-1" });
    const entry = createEntry({
      target: "Translated",
      status: "proofread",
      translated_by: reviewer.id,
      proofread_by: [reviewer.id, "proofreader-2"],
      proofread_count: 2,
    });
    const reason = getReviewBlockReason(reviewer, entry, {
      proofread_required: 2,
      review_required: true,
      allow_self_review: false,
    });

    expect(reason).toBe("self_review_disabled");
    expect(getReviewBlockMessage(reason)).toBe(
      "当前用户是最近一轮校对的首位校对者，项目未允许审核自己校对的译文。",
    );
    expect(
      getReviewBlockReason(
        reviewer,
        {
          ...entry,
          proofread_by: ["proofreader-1", reviewer.id],
        },
        {
          proofread_required: 2,
          review_required: true,
          allow_self_review: false,
        },
      ),
    ).toBeNull();
  });
});
