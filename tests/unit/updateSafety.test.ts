import { describe, expect, it } from "vitest";
import {
  getPendingUpdateBlockedReason,
  type UpdateSafetyState,
} from "../../src/services/updateSafety";

const blockedSafety: UpdateSafetyState = {
  canAutoRefresh: false,
  reason: "完成当前编辑后再刷新。",
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
          canAutoRefresh: true,
          reason: "当前可以刷新。",
        },
        true,
      ),
    ).toBe("");
  });
});
