import { describe, expect, it } from "vitest";
import {
  buildMemberOptions,
  getMemberDisplayName,
} from "../../src/model/memberOptions";
import { createMember } from "./factories";

describe("member options", () => {
  it("keeps disabled and deleted historical member references visible", () => {
    const active = createMember(["translator"], {
      id: "active-1",
      name: "Active",
    });
    const disabled = createMember(["translator"], {
      id: "disabled-1",
      name: "Disabled",
      active: false,
    });

    expect(
      buildMemberOptions([active, disabled], ["disabled-1", "deleted-1"]),
    ).toEqual([
      {
        id: "active-1",
        label: "Active",
        active: true,
        missing: false,
      },
      {
        id: "disabled-1",
        label: "Disabled（已禁用）",
        active: false,
        missing: false,
      },
      {
        id: "deleted-1",
        label: "deleted-1（成员已删除）",
        active: false,
        missing: true,
      },
    ]);
    expect(getMemberDisplayName([active, disabled], "deleted-1")).toBe(
      "deleted-1（成员已删除）",
    );
  });
});
