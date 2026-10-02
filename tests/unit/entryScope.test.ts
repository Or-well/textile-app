import { describe, expect, it } from "vitest";
import { resolveEntryScope } from "../../src/model/entryScope";
import { createEntry } from "./factories";

describe("continuous entry scope", () => {
  it("keeps the cross-file navigation order after editing changes status and sorting", () => {
    const first = createEntry({ id: "file-b:1", file_id: "file-b", disputed: true });
    const second = createEntry({ id: "file-a:1", file_id: "file-a", disputed: true });
    const ids = [first.id, second.id];
    const resolved = { ...first, disputed: false, target: "修正后的译文", updated_at: "2030-01-01T00:00:00Z" };
    const rows = resolveEntryScope(ids, [second, resolved]);
    expect(rows.map((entry) => entry.id)).toEqual(ids);
    expect(rows[0]).toBe(resolved);
    expect(rows[0]?.disputed).toBe(false);
    expect(rows[0]?.target).toBe("修正后的译文");
  });

  it("includes selections outside the visible page and current filter", () => {
    const entries = Array.from({ length: 60 }, (_, index) => createEntry({ id: `entry-${index}` }));
    const rows = resolveEntryScope(["entry-59", "entry-1"], entries);
    expect(rows.map((entry) => entry.id)).toEqual(["entry-59", "entry-1"]);
  });

  it("does not introduce new entries and skips removed or duplicate references", () => {
    const retained = createEntry({ id: "retained" });
    const newcomer = createEntry({ id: "newcomer" });
    expect(resolveEntryScope(["removed", "retained", "retained"], [newcomer, retained])).toEqual([retained]);
    expect(resolveEntryScope([], [retained])).toEqual([]);
  });
});
