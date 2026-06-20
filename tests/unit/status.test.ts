import { describe, expect, it } from "vitest";
import {
  applyEntryWorkflowStatus,
  getEntryProofreadCount,
  inferEntryStatus,
  isEntryReleaseComplete,
  normalizeEntry,
  normalizeProofreadUsers,
  normalizeWorkflowSettings,
} from "../../src/model/status";
import { createEntry } from "./factories";

describe("normalizeWorkflowSettings", () => {
  it("uses the default workflow", () => {
    expect(normalizeWorkflowSettings()).toEqual({
      enable_tasks: true,
      enable_proofread: true,
      enable_review: true,
      proofread_required: 1,
      review_required: true,
      allow_self_proofread: false,
      allow_self_review: false,
      allow_same_user_multi_proofread: false,
    });
  });

  it("normalizes legacy enable flags and clamps proofread rounds", () => {
    expect(
      normalizeWorkflowSettings({
        enable_proofread: false,
        enable_review: false,
      }),
    ).toMatchObject({
      enable_proofread: false,
      proofread_required: 0,
      enable_review: false,
      review_required: false,
    });

    expect(
      normalizeWorkflowSettings({
        proofread_required: 3,
        review_required: false,
      }),
    ).toMatchObject({
      enable_proofread: true,
      proofread_required: 3,
      enable_review: false,
      review_required: false,
    });
  });
});

describe("proofread normalization", () => {
  it("trims users and keeps the greatest recorded proofread count", () => {
    expect(normalizeProofreadUsers([" member-1 ", "", "member-2"])).toEqual([
      "member-1",
      "member-2",
    ]);
    expect(
      getEntryProofreadCount({
        proofread_by: ["member-1", "member-2"],
        proofread_count: 1,
      }),
    ).toBe(2);
  });
});

describe("legacy entry normalization", () => {
  it("infers status from audit fields and preserves legacy disputes", () => {
    expect(inferEntryStatus({ target: "Translated" })).toBe("translated");
    expect(inferEntryStatus({ proofread_by: "proofreader" })).toBe("proofread");
    expect(inferEntryStatus({ reviewed_by: "reviewer" })).toBe("reviewed");

    const normalized = normalizeEntry({
      ...createEntry(),
      status: "disputed",
      target: "Translated",
      proofread_by: " proofreader ",
    });

    expect(normalized).toMatchObject({
      status: "proofread",
      disputed: true,
      proofread_by: ["proofreader"],
      proofread_count: 1,
    });
  });
});

describe("applyEntryWorkflowStatus", () => {
  it("resets downstream audit fields when returning to translated", () => {
    const result = applyEntryWorkflowStatus(
      createEntry({
        target: "Translated",
        status: "reviewed",
        translated_by: "translator",
        proofread_by: ["proofreader"],
        proofread_count: 1,
        reviewed_by: "reviewer",
      }),
      "translated",
      "editor",
    );

    expect(result).toMatchObject({
      status: "translated",
      translated_by: "translator",
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
    });
  });

  it("requires distinct proofreaders unless repeat proofread is enabled", () => {
    const entry = createEntry({
      target: "Translated",
      status: "translated",
      translated_by: "translator",
    });
    const first = applyEntryWorkflowStatus(entry, "proofread", "proofreader-1", {
      proofread_required: 2,
    });
    const duplicate = applyEntryWorkflowStatus(first, "proofread", "proofreader-1", {
      proofread_required: 2,
    });
    const second = applyEntryWorkflowStatus(duplicate, "proofread", "proofreader-2", {
      proofread_required: 2,
    });

    expect(first).toMatchObject({ status: "translated", proofread_count: 1 });
    expect(duplicate).toMatchObject({ status: "translated", proofread_count: 1 });
    expect(second).toMatchObject({
      status: "proofread",
      proofread_count: 2,
      proofread_by: ["proofreader-1", "proofreader-2"],
    });
  });
});

describe("isEntryReleaseComplete", () => {
  it("uses review completion when review is required", () => {
    expect(
      isEntryReleaseComplete(
        createEntry({ target: "Translated", status: "proofread" }),
      ),
    ).toBe(false);
    expect(
      isEntryReleaseComplete(
        createEntry({ target: "Translated", status: "reviewed" }),
      ),
    ).toBe(true);
  });

  it("falls back to proofread completion when review is disabled", () => {
    const workflow = {
      proofread_required: 2 as const,
      review_required: false,
    };

    expect(
      isEntryReleaseComplete(
        createEntry({
          target: "Translated",
          status: "translated",
          proofread_count: 1,
        }),
        workflow,
      ),
    ).toBe(false);
    expect(
      isEntryReleaseComplete(
        createEntry({
          target: "Translated",
          status: "proofread",
          proofread_count: 2,
        }),
        workflow,
      ),
    ).toBe(true);
  });

  it("requires translated text when review and proofread are disabled", () => {
    const workflow = {
      proofread_required: 0 as const,
      review_required: false,
    };

    expect(isEntryReleaseComplete(createEntry(), workflow)).toBe(false);
    expect(
      isEntryReleaseComplete(createEntry({ target: " Translated " }), workflow),
    ).toBe(true);
  });
});
