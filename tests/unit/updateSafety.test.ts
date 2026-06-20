import { describe, expect, it } from "vitest";
import { clearAppDraft, setAppDraft } from "../../src/services/appDraft";
import { beginAppOperation } from "../../src/services/appOperation";
import {
  getPendingUpdateBlockedReason,
  setAppUpdateSafety,
  type UpdateSafetyState,
} from "../../src/services/updateSafety";

const blockedSafety: UpdateSafetyState = {
  canApplyUpdate: false,
  reason: "存在未保存的译文，请先保存或放弃修改。",
};

describe("getPendingUpdateBlockedReason", () => {
  it("does not expose a refresh warning when no update is pending", () => {
    expect(getPendingUpdateBlockedReason(blockedSafety, false)).toBe("");
  });

  it("returns the safety reason only for a pending blocked update", () => {
    expect(getPendingUpdateBlockedReason(blockedSafety, true)).toBe(
      blockedSafety.reason,
    );
    expect(
      getPendingUpdateBlockedReason(
        {
          canApplyUpdate: true,
          reason: "",
        },
        true,
      ),
    ).toBe("");
  });
});

describe("setAppUpdateSafety", () => {
  it("allows updates regardless of the current page when no work is active", () => {
    expect(setAppUpdateSafety({}).canApplyUpdate).toBe(true);
  });

  it("blocks updates while an operation is active and clears afterwards", () => {
    const finish = beginAppOperation("导出修改包");

    expect(setAppUpdateSafety({})).toMatchObject({
      canApplyUpdate: false,
      blocker: {
        kind: "operation",
        labels: ["导出修改包"],
      },
    });

    finish();
    expect(setAppUpdateSafety({}).canApplyUpdate).toBe(true);
  });

  it("blocks updates only while a real unsaved draft exists", () => {
    setAppDraft("test-entry", "译文", true);

    expect(setAppUpdateSafety({})).toMatchObject({
      canApplyUpdate: false,
      blocker: {
        kind: "unsaved-draft",
        labels: ["译文"],
      },
    });

    clearAppDraft("test-entry");
    expect(setAppUpdateSafety({}).canApplyUpdate).toBe(true);
  });
});
