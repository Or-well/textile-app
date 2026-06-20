import { describe, expect, it } from "vitest";
import {
  buildChangePackageHashPayload,
  calculateChangePackageContentHash,
  type ChangePackagePayload,
} from "../../src/services/changePackageHash";
import { createEntry } from "./factories";

function createPayload(
  overrides: Partial<ChangePackagePayload> = {},
): ChangePackagePayload {
  return {
    entries: {},
    comments: {},
    terms: {},
    contexts: {},
    sourceFiles: {},
    tasks: {},
    projectFiles: {},
    memberFiles: {},
    events: [],
    ...overrides,
  };
}

describe("change-package content hash", () => {
  it("normalizes record paths and row order without mutating input", () => {
    const second = createEntry({ id: "entry-2", index: 2 });
    const first = createEntry({ id: "entry-1", index: 1 });
    const payload = createPayload({
      entries: {
        "entries/z.jsonl": [second, first],
        "entries/a.jsonl": [],
      },
      sourceFiles: {
        "source/z.txt": "Z",
        "source/a.txt": "A",
      },
    });
    const original = structuredClone(payload);
    const normalized = buildChangePackageHashPayload(payload);

    expect(normalized.entries.map(({ path }) => path)).toEqual([
      "entries/a.jsonl",
      "entries/z.jsonl",
    ]);
    expect(normalized.entries[1]?.rows.map(({ id }) => id)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(normalized.source.map(({ path }) => path)).toEqual([
      "source/a.txt",
      "source/z.txt",
    ]);
    expect(payload).toEqual(original);
  });

  it("produces the same hash for equivalent insertion and row order", async () => {
    const first = createEntry({ id: "entry-1", index: 1, target: "First" });
    const second = createEntry({ id: "entry-2", index: 2, target: "Second" });
    const left = createPayload({
      entries: {
        "entries/b.jsonl": [second, first],
        "entries/a.jsonl": [],
      },
      sourceFiles: {
        "source/b.txt": "B",
        "source/a.txt": "A",
      },
    });
    const right = createPayload({
      entries: {
        "entries/a.jsonl": [],
        "entries/b.jsonl": [first, second],
      },
      sourceFiles: {
        "source/a.txt": "A",
        "source/b.txt": "B",
      },
    });

    await expect(calculateChangePackageContentHash(left)).resolves.toBe(
      await calculateChangePackageContentHash(right),
    );
  });

  it("changes the hash when package content changes", async () => {
    const original = createPayload({
      entries: {
        "entries/file.jsonl": [
          createEntry({ target: "Original", status: "translated" }),
        ],
      },
    });
    const changed = structuredClone(original);
    changed.entries["entries/file.jsonl"]![0]!.target = "Changed";

    expect(await calculateChangePackageContentHash(original)).not.toBe(
      await calculateChangePackageContentHash(changed),
    );
  });

  it("keeps the protocol fixture hash stable", async () => {
    const payload = createPayload({
      entries: {
        "entries/file.jsonl": [
          createEntry({
            id: "entry-1",
            index: 1,
            target: "Translated",
            status: "translated",
          }),
        ],
      },
      contexts: {
        "contexts/file.txt": "Context",
      },
      sourceFiles: {
        "source/file.txt": "Source",
      },
    });

    await expect(calculateChangePackageContentHash(payload)).resolves.toBe(
      "sha256:431a74c28e1269165fc9954491acd765bafc6f45aff18c19c607be404f7086e8",
    );
  });
});
