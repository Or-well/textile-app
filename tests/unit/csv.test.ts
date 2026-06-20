import { describe, expect, it } from "vitest";
import { parseEntriesFromSourceFile } from "../../src/services/entries";
import { parseCsvRecords } from "../../src/utils/csv";

describe("csv parsing", () => {
  it("parses quoted commas, escaped quotes, and multiline fields", () => {
    const records = parseCsvRecords(
      'key,source,target\nline.1,"Hello, ""world""","第一行\n第二行"\n',
    );

    expect(records).toEqual([
      ["key", "source", "target"],
      ["line.1", 'Hello, "world"', "第一行\n第二行"],
    ]);
  });

  it("reports unclosed quoted fields", () => {
    expect(() => parseCsvRecords('key,source\nline.1,"broken\n')).toThrow(
      "CSV 引号未闭合",
    );
  });

  it("rejects duplicate source entry keys during source import", () => {
    expect(() =>
      parseEntriesFromSourceFile(
        "file-1",
        "script.csv",
        "key,source,target\nline.1,Hello,\nline.1,Again,\n",
      ),
    ).toThrow("重复 key");
  });
});
