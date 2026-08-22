import { afterEach, describe, expect, it } from "vitest";
import { setCurrentUser } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  exportFile,
  exportProject,
  getReleaseExportSummary,
  setExporterProjectStorage,
} from "../../src/services/exporter";
import { readZip } from "../../src/utils/zip";
import { createEntry, createMember, createProject } from "./factories";

function createProjectFile(
  id: string,
  name: string,
  type: "json" | "txt" | "csv" | "ks" = "ks",
) {
  return {
    id,
    name,
    source_path: `source/${id}.${type}`,
    entries_path: `entries/${id}`,
    type,
    hidden: false,
    locked: false,
  };
}

async function prepareExporter(files = [createProjectFile("file-1", "chapter.part.ks")]) {
  const storage = createProjectStorage(createMemoryProjectDirectory({}));

  await storage.writeJson(
    "project.json",
    createProject({
      name: "叶间乡愁",
      files,
      settings: {
        workflow: {
          proofread_required: 0,
          review_required: false,
        },
      },
    }),
  );

  for (const [index, file] of files.entries()) {
    await storage.writeJsonl(`${file.entries_path}/chunk_0001.jsonl`, [
      createEntry({
        id: `${file.id}:000001`,
        file_id: file.id,
        index: 1,
        key: `line-${index + 1}`,
        target: `译文-${index + 1}`,
        status: "translated",
      }),
    ]);
  }

  setExporterProjectStorage(storage);
  setCurrentUser(createMember(["owner"]));
}

describe("release exporter", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it.each([
    ["json", "chapter.part.json"],
    ["txt", "chapter.part.txt"],
    ["csv", "chapter.part.csv"],
    ["ks", "chapter.part.ks"],
  ] as const)("keeps the original base name when exporting %s", async (format, fileName) => {
    await prepareExporter();

    const exported = await exportFile("file-1", { format });

    expect(exported.fileName).toBe(fileName);
    expect(exported.path).toBe(fileName);
  });

  it("keeps the four format adapters on their documented content shapes", async () => {
    await prepareExporter();

    const json = await exportFile("file-1", {
      format: "json",
      include_source: true,
      include_key: true,
    });
    const txt = await exportFile("file-1", {
      format: "txt",
      include_source: true,
      include_key: true,
    });
    const csv = await exportFile("file-1", {
      format: "csv",
      include_source: true,
      include_key: true,
    });
    const ks = await exportFile("file-1", {
      format: "ks",
      include_source: true,
      include_key: false,
    });

    expect(JSON.parse(json.content).entries[0]).toMatchObject({
      key: "line-1",
      source: "Source",
      target: "译文-1",
    });
    expect(txt.content).toContain("原文：Source");
    expect(txt.content).toContain("译文：译文-1");
    expect(csv.content.split("\n")[0]).toBe("id,index,key,speaker,source,target,status");
    expect(ks.content).toBe("译文-1\n");
  });

  it("puts only converted files at the zip root", async () => {
    await prepareExporter();

    const result = await exportProject({
      format: "json",
      exportedAt: "2026-08-22T00:00:00.000Z",
    });
    const files = await readZip(await result.blob.arrayBuffer());

    expect(result.fileName).toBe("成品-叶间乡愁-2026-08-22.zip");
    expect(Object.keys(files)).toEqual(["chapter.part.json"]);
    expect(files["manifest.json"]).toBeUndefined();
    expect(Object.keys(files).some((path) => path.startsWith("reports/"))).toBe(false);
    expect(Object.keys(files).some((path) => path.startsWith("release/"))).toBe(false);
  });

  it("rejects file names that collide after conversion", async () => {
    await prepareExporter([
      createProjectFile("file-1", "chapter.ks", "ks"),
      createProjectFile("file-2", "chapter.txt", "txt"),
    ]);

    await expect(exportProject({ format: "json" })).rejects.toThrow(
      "导出后会产生同名文件“chapter.json”",
    );
  });

  it("builds the release summary without running output path conversion", async () => {
    await prepareExporter([
      createProjectFile("file-1", "chapter.ks", "ks"),
      createProjectFile("file-2", "chapter.txt", "txt"),
    ]);

    await expect(
      getReleaseExportSummary({ format: "json" }),
    ).resolves.toMatchObject({
      totalEntries: 2,
      exportEntries: 2,
    });
  });
});
