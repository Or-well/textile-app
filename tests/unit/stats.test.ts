import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESS_WEIGHTS,
  calculateEntryProgress,
  normalizeProgressWeights,
} from "../../src/services/stats";
import { createEntry } from "./factories";

describe("normalizeProgressWeights", () => {
  it("normalizes configured weights", () => {
    expect(
      normalizeProgressWeights({
        translation: 2,
        proofread: 1,
        review: 1,
      }),
    ).toEqual({
      translationWeight: 0.5,
      proofreadWeight: 0.25,
      reviewWeight: 0.25,
    });
  });

  it("removes review weight and renormalizes when review is disabled", () => {
    const weights = normalizeProgressWeights(
      {
        translation: 0.4,
        proofread: 0.3,
        review: 0.3,
      },
      { review_required: false },
    );

    expect(weights.translationWeight).toBeCloseTo(4 / 7);
    expect(weights.proofreadWeight).toBeCloseTo(3 / 7);
    expect(weights.reviewWeight).toBe(0);
  });

  it("falls back to defaults for invalid or empty weights", () => {
    expect(
      normalizeProgressWeights({
        translation: -1,
        proofread: 1,
        review: 1,
      }),
    ).toEqual(DEFAULT_PROGRESS_WEIGHTS);
    expect(
      normalizeProgressWeights({
        translation: 0,
        proofread: 0,
        review: 0,
      }),
    ).toEqual(DEFAULT_PROGRESS_WEIGHTS);
  });
});

describe("calculateEntryProgress", () => {
  it("returns zero progress for an empty project", () => {
    expect(calculateEntryProgress([])).toMatchObject({
      totalEntries: 0,
      completedEntries: 0,
      translationProgress: 0,
      proofreadProgress: 0,
      reviewProgress: 0,
      progressPercent: 0,
    });
  });

  it("counts workflow stages and calculates weighted progress", () => {
    const stats = calculateEntryProgress([
      createEntry({ id: "untranslated" }),
      createEntry({
        id: "translated",
        target: "Translated",
        status: "translated",
      }),
      createEntry({
        id: "proofread",
        target: "Proofread",
        status: "proofread",
        proofread_count: 1,
      }),
      createEntry({
        id: "reviewed",
        target: "Reviewed",
        status: "reviewed",
        proofread_count: 1,
      }),
    ]);

    expect(stats).toMatchObject({
      totalEntries: 4,
      untranslatedEntries: 1,
      translatedEntries: 1,
      proofreadEntries: 2,
      reviewedEntries: 1,
      completedEntries: 1,
      translationProgress: 75,
      proofreadProgress: 50,
      reviewProgress: 25,
      progressPercent: 53,
    });
  });

  it("uses required proofread rounds and counts disputes independently", () => {
    const stats = calculateEntryProgress(
      [
        createEntry({
          id: "round-1",
          target: "First round",
          status: "translated",
          proofread_count: 1,
          disputed: true,
        }),
        createEntry({
          id: "round-2",
          target: "Second round",
          status: "proofread",
          proofread_count: 2,
        }),
      ],
      undefined,
      {
        proofread_required: 2,
        review_required: false,
      },
    );

    expect(stats).toMatchObject({
      totalEntries: 2,
      proofreadEntries: 1,
      reviewedEntries: 0,
      disputedEntries: 1,
      completedEntries: 1,
      translationProgress: 100,
      proofreadProgress: 50,
      reviewProgress: 0,
      progressPercent: 79,
      proofreadRequired: 2,
      reviewRequired: false,
    });
  });
});
