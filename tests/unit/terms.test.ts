import { afterEach, describe, expect, it } from "vitest";
import { setCurrentUser } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  checkTermUsageWithTerms,
  exportTermsFile,
  setTermsProjectStorage,
} from "../../src/services/terms";
import type { Term } from "../../src/model/types";
import { createMember } from "./factories";

function createTerm(overrides: Partial<Term> = {}): Term {
  return {
    id: "term-1",
    source: "Magic",
    target: "Magic",
    part_of_speech: "",
    note: "",
    variants: [],
    case_sensitive: false,
    created_by: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("terms", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("applies case-sensitive matching to recommended target terms", () => {
    const term = createTerm({ case_sensitive: true });

    expect(
      checkTermUsageWithTerms([term], "Magic appears", "magic appears")[0]
        .isRecommendedUsed,
    ).toBe(false);
    expect(
      checkTermUsageWithTerms([term], "Magic appears", "Magic appears")[0]
        .isRecommendedUsed,
    ).toBe(true);
  });

  it("keeps term export permission checks in the service layer", async () => {
    const root = createMemoryProjectDirectory({}, "terms.hproj");
    const storage = createProjectStorage(root);

    await storage.writeJsonl("terms/terms.jsonl", [createTerm()]);
    setTermsProjectStorage(storage);
    setCurrentUser(createMember(["readonly"], { id: "reader-1" }));

    await expect(exportTermsFile()).rejects.toThrow("Permission denied");
  });
});
