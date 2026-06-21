import { describe, expect, it } from "vitest";
import {
  applyEntryTargetChange,
  applyEntryWorkflowOperation,
  applyEntryWorkflowStatus,
  getCurrentProofreadRoundFirstProofreader,
  getEntryProofreadCount,
  getFirstTranslator,
  inferEntryStatus,
  isEntryProofreadComplete,
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

describe("proofread completion", () => {
  it("requires translated text even when proofread count is enough", () => {
    expect(
      isEntryProofreadComplete(
        createEntry({
          target: "",
          proofread_count: 1,
        }),
      ),
    ).toBe(false);
    expect(
      isEntryProofreadComplete(
        createEntry({
          target: "Translated",
          proofread_count: 1,
        }),
      ),
    ).toBe(true);
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

describe("entry workflow audit actors", () => {
  it("uses the first translator and current proofread round first proofreader", () => {
    expect(
      getFirstTranslator(
        createEntry({ translated_by: " translator-latest " }),
      ),
    ).toBe("translator-latest");
    expect(
      getCurrentProofreadRoundFirstProofreader(
        createEntry({
          proofread_by: ["proofreader-1", "proofreader-2", "proofreader-1"],
        }),
      ),
    ).toBe("proofreader-1");
    expect(
      getCurrentProofreadRoundFirstProofreader({
        proofread_by: " legacy-proofreader ",
      }),
    ).toBe("legacy-proofreader");
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

  it("does not fabricate a proofread record when approving review", () => {
    const result = applyEntryWorkflowStatus(
      createEntry({
        target: "Translated",
        status: "proofread",
        translated_by: "translator-1",
        proofread_by: [],
        proofread_count: 1,
      }),
      "reviewed",
      "reviewer-1",
      {
        proofread_required: 1,
        review_required: true,
      },
    );

    expect(result).toMatchObject({
      status: "reviewed",
      proofread_by: [],
      proofread_count: 1,
      reviewed_by: "reviewer-1",
    });
  });
});

describe("applyEntryWorkflowOperation", () => {
  it("keeps and advances workflow when proofread changes the target", () => {
    expect(
      applyEntryWorkflowOperation(
        createEntry({
          target: "Before",
          status: "translated",
          translated_by: "translator-1",
          proofread_by: ["proofreader-1"],
          proofread_count: 1,
        }),
        {
          userId: "proofreader-2",
          target: "After",
          operation: "proofread",
          workflow: { proofread_required: 2 },
        },
      ),
    ).toMatchObject({
      target: "After",
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1", "proofreader-2"],
      proofread_count: 2,
      reviewed_by: "",
    });
  });

  it("keeps proofread records when review changes the target", () => {
    expect(
      applyEntryWorkflowOperation(
        createEntry({
          target: "Before",
          status: "proofread",
          translated_by: "translator-1",
          proofread_by: ["proofreader-1"],
          proofread_count: 1,
        }),
        {
          userId: "reviewer-1",
          target: "After",
          operation: "review",
          workflow: {
            proofread_required: 1,
            review_required: true,
          },
        },
      ),
    ).toMatchObject({
      target: "After",
      status: "reviewed",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: "reviewer-1",
    });
  });
});

describe("applyEntryTargetChange", () => {
  it("resets downstream workflow when translated text changes", () => {
    const result = applyEntryTargetChange(
      createEntry({
        target: "Reviewed",
        status: "reviewed",
        translated_by: "translator-1",
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
        reviewed_by: "reviewer-1",
        disputed: true,
      }),
      "Changed",
      {
        userId: "editor-1",
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    );

    expect(result).toMatchObject({
      target: "Changed",
      status: "translated",
      translated_by: "editor-1",
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
      disputed: true,
      updated_by: "editor-1",
      updated_at: "2026-06-21T00:00:00.000Z",
    });
  });

  it("returns an empty translation to untranslated", () => {
    expect(
      applyEntryTargetChange(
        createEntry({
          target: "Translated",
          status: "proofread",
          translated_by: "translator-1",
          proofread_by: ["proofreader-1"],
          proofread_count: 1,
        }),
        " ",
        {
          userId: "editor-1",
          updatedAt: "2026-06-21T00:00:00.000Z",
        },
      ),
    ).toMatchObject({
      status: "untranslated",
      translated_by: "",
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
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
