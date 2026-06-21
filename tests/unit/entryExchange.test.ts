import { describe, expect, it } from "vitest";
import type { Entry } from "../../src/model/types";
import { parseEntriesFromSourceFile, setEntriesProjectStorage } from "../../src/services/entries";
import { exportEntryExchangeFile } from "../../src/services/entryExchange";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { setPermissionProject } from "../../src/services/permissions";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";

describe("entry exchange import", () => {
  it("keeps legacy JSON import behavior when workflow fields are absent", () => {
    const entries = parseEntriesFromSourceFile(
      "file-1",
      "legacy.json",
      JSON.stringify([
        {
          key: "line-1",
          index: 99,
          source: "Source",
          target: "Target",
        },
      ]),
    );

    expect(entries).toMatchObject([
      {
        key: "line-1",
        index: 1,
        target: "Target",
        status: "translated",
        proofread_count: 0,
        proofread_by: [],
      },
    ]);
  });

  it.each([
    ["json", 1],
    ["json", 2],
    ["json", 3],
    ["jsonl", 1],
  ] as const)(
    "imports valid %s exchange workflow fields with %i proofread rounds",
    (format, proofreadCount) => {
      const row = {
        key: "line-7",
        index: 7,
        speaker: "Speaker",
        source: " Source ",
        target: "Target",
        context: "Context",
        status: "proofread",
        translated_by: "",
        proofread_count: proofreadCount,
        proofread_by: [],
        reviewed_by: "",
      };
      const text =
        format === "json" ? JSON.stringify([row]) : `${JSON.stringify(row)}\n`;
      const entries = parseEntriesFromSourceFile(
        "file-1",
        `exchange.${format}`,
        text,
      );

      expect(entries).toMatchObject([
        {
          id: "file-1:000007",
          key: "line-7",
          index: 7,
          source: " Source ",
          target: "Target",
          status: "proofread",
          translated_by: "",
          proofread_count: proofreadCount,
          proofread_by: [],
          reviewed_by: "",
        },
      ]);
    },
  );

  it("rejects contradictory workflow fields", () => {
    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "exchange.json",
        JSON.stringify([
          {
            key: "line-1",
            source: "Source",
            target: "Target",
            status: "proofread",
            proofread_count: 0,
            proofread_by: [],
          },
        ]),
      ),
    ).toThrow("proofread_count 必须大于 0");
  });

  it("rejects invalid proofreader arrays and counts", () => {
    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "exchange.json",
        JSON.stringify([
          {
            key: "line-1",
            source: "Source",
            target: "Target",
            status: "proofread",
            translated_by: "",
            proofread_count: 1,
            proofread_by: "proofreader-1",
            reviewed_by: "",
          },
        ]),
      ),
    ).toThrow("proofread_by 必须是");

    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "exchange.json",
        JSON.stringify([
          {
            key: "line-1",
            source: "Source",
            target: "Target",
            status: "proofread",
            translated_by: "",
            proofread_count: 1,
            proofread_by: ["proofreader-1", "proofreader-2"],
            reviewed_by: "",
          },
        ]),
      ),
    ).toThrow("校对成员数量不能大于");
  });

  it("rejects protected management fields in exchange rows", () => {
    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "exchange.json",
        JSON.stringify([
          {
            key: "line-1",
            source: "Source",
            target: "Target",
            status: "translated",
            translated_by: "",
            proofread_count: 0,
            proofread_by: [],
            reviewed_by: "",
            locked: true,
          },
        ]),
      ),
    ).toThrow("不允许导入的管理字段 locked");
  });

  it("allows reviewed entries with unknown users and no proofread stage", () => {
    const entries = parseEntriesFromSourceFile(
      "file-1",
      "exchange.json",
      JSON.stringify([
        {
          key: "line-1",
          source: "Source",
          target: "Target",
          status: "reviewed",
          translated_by: "",
          proofread_count: 0,
          proofread_by: [],
          reviewed_by: "",
        },
      ]),
    );

    expect(entries).toMatchObject([
      {
        status: "reviewed",
        proofread_count: 0,
        proofread_by: [],
        reviewed_by: "",
      },
    ]);
  });

  it("rejects duplicate exchange indexes", () => {
    const workflow = {
      status: "translated",
      translated_by: "",
      proofread_count: 0,
      proofread_by: [],
      reviewed_by: "",
    };

    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "exchange.json",
        JSON.stringify([
          { key: "line-1", index: 1, source: "One", target: "一", ...workflow },
          { key: "line-2", index: 1, source: "Two", target: "二", ...workflow },
        ]),
      ),
    ).toThrow("重复 index");
  });
});

describe("entry exchange export", () => {
  async function createExportContext(entries: Entry[]) {
    const root = createMemoryProjectDirectory({}, "exchange-export.hproj");
    const storage = createProjectStorage(root);
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "script.json",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
    });
    const actor = createMember(["readonly"], { id: "reader-1" });

    await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", entries);
    setEntriesProjectStorage(storage);
    setPermissionProject(project);

    return { project, actor };
  }

  it.each(["json", "jsonl"] as const)(
    "exports a round-trip %s file without management fields",
    async (format) => {
      const entry = createEntry({
        id: "file-1:000003",
        file_id: "file-1",
        index: 3,
        key: "line-3",
        speaker: "Speaker",
        source: "Source",
        target: "Target",
        context: "Context",
        status: "proofread",
        translated_by: "",
        proofread_count: 1,
        proofread_by: [],
        reviewed_by: "",
        assignee: "member-2",
        disputed: true,
        locked: false,
      });
      const { project, actor } = await createExportContext([entry]);
      const exported = await exportEntryExchangeFile(
        project,
        "file-1",
        format,
        actor,
      );
      const text = await exported.blob.text();
      const imported = parseEntriesFromSourceFile(
        "file-2",
        exported.fileName,
        text,
      );

      expect(exported.entryCount).toBe(1);
      expect(text).not.toContain("assignee");
      expect(text).not.toContain("disputed");
      expect(text).not.toContain("locked");
      expect(imported).toMatchObject([
        {
          index: 3,
          key: "line-3",
          status: "proofread",
          proofread_count: 1,
          proofread_by: [],
        },
      ]);
    },
  );

  it("blocks incomplete export when the file contains hidden entries", async () => {
    const { project, actor } = await createExportContext([
      createEntry({
        id: "file-1:000001",
        file_id: "file-1",
        index: 1,
        hidden: true,
      }),
    ]);

    await expect(
      exportEntryExchangeFile(project, "file-1", "json", actor),
    ).rejects.toThrow("包含隐藏词条");
  });

  it("requires file view permission", async () => {
    const { project } = await createExportContext([
      createEntry({
        id: "file-1:000001",
        file_id: "file-1",
        index: 1,
      }),
    ]);
    const actor = createMember(["readonly"], {
      id: "blocked-reader",
      deny_permissions: ["file.view"],
    });

    await expect(
      exportEntryExchangeFile(project, "file-1", "json", actor),
    ).rejects.toThrow("没有导出词条交换文件的权限");
  });

  it("does not export workflow data that cannot be imported again", async () => {
    const { project, actor } = await createExportContext([
      createEntry({
        id: "file-1:000001",
        file_id: "file-1",
        index: 1,
        target: "Target",
        status: "proofread",
        proofread_count: 0,
        proofread_by: [],
      }),
    ]);

    await expect(
      exportEntryExchangeFile(project, "file-1", "json", actor),
    ).rejects.toThrow("proofread_count 必须大于 0");
  });
});
