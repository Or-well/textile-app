import { describe, expect, it } from "vitest";
import { getReleaseExportSuggestedFileName } from "../../src/services/exporter";
import { getProjectPackageSuggestedFileName } from "../../src/services/projectPackage";
import { sanitizeFileNamePart } from "../../src/utils/fileNames";
import { createProject } from "./factories";

describe("user-facing file names", () => {
  it("uses project names instead of internal project ids", () => {
    const project = createProject({
      project_id: "project-internal-123",
      name: "叶间乡愁",
    });

    expect(getProjectPackageSuggestedFileName(project)).toMatch(
      /^叶间乡愁-\d{4}-\d{2}-\d{2}\.hproj$/,
    );
    expect(
      getReleaseExportSuggestedFileName(
        project.name,
        "2026-08-22T00:00:00.000Z",
      ),
    ).toBe("成品-叶间乡愁-2026-08-22.zip");
  });

  it("removes characters that are unsafe in file names", () => {
    expect(sanitizeFileNamePart('A/B: C*D?', "fallback")).toBe("A-B- C-D-");
  });
});
