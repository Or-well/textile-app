import { afterEach, describe, expect, it } from "vitest";
import type { Term } from "../../src/model/types";
import { setCurrentUser } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  executeTermBatch,
  previewTermBatch,
} from "../../src/services/termBatch";
import {
  loadTermsFresh,
  setTermsProjectStorage,
} from "../../src/services/terms";
import { createMember } from "./factories";

function createTerm(id: string, overrides: Partial<Term> = {}): Term {
  return {
    id,
    source: id,
    target: `${id}-target`,
    part_of_speech: "名词",
    note: "",
    variants: [],
    case_sensitive: false,
    created_by: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function createTermStorage() {
  const root = createMemoryProjectDirectory({}, "term-batch.hproj");
  const storage = createProjectStorage(root);

  await storage.writeJsonl("terms/terms.jsonl", [
    createTerm("term-1"),
    createTerm("term-2", { case_sensitive: true }),
  ]);
  setTermsProjectStorage(storage);

  return storage;
}

describe("term batch", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("previews missing and no-op terms without writing", async () => {
    await createTermStorage();
    const actor = createMember(["owner"]);

    const preview = await previewTermBatch({
      termIds: ["term-1", "term-missing"],
      operation: "set_part_of_speech",
      value: "名词",
      actor,
    });

    expect(preview.applicableTermIds).toEqual([]);
    expect(preview.skippedReasonCounts).toEqual([
      { reason: "词性已经是指定值", count: 1 },
      { reason: "术语不存在或已被删除", count: 1 },
    ]);
  });

  it("updates selected terms with one saved result", async () => {
    await createTermStorage();
    const actor = createMember(["owner"]);

    const result = await executeTermBatch({
      termIds: ["term-1", "term-2"],
      operation: "clear_case_sensitive",
      actor,
    });

    expect(result.applicableTermIds).toEqual(["term-2"]);
    expect((await loadTermsFresh()).find((term) => term.id === "term-2"))
      .toMatchObject({
        case_sensitive: undefined,
      });
  });

  it("deletes selected terms and keeps unselected rows", async () => {
    await createTermStorage();
    const actor = createMember(["owner"]);

    await executeTermBatch({
      termIds: ["term-1"],
      operation: "delete",
      actor,
    });

    expect((await loadTermsFresh()).map((term) => term.id)).toEqual(["term-2"]);
  });

  it("keeps update permission enforcement in the service", async () => {
    await createTermStorage();
    const actor = createMember(["readonly"]);

    await expect(
      previewTermBatch({
        termIds: ["term-1"],
        operation: "set_case_sensitive",
        actor,
      }),
    ).rejects.toThrow("没有执行该术语批量操作的权限");
  });
});
