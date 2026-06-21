import { describe, expect, it } from "vitest";
import { canTransitionTaskStatus } from "../../src/model/taskStatus";

describe("task status transitions", () => {
  it("exposes the same valid actions used by task services and UI", () => {
    expect(canTransitionTaskStatus("complete", "submitted", "completed")).toBe(true);
    expect(canTransitionTaskStatus("complete", "assigned", "completed")).toBe(false);
    expect(canTransitionTaskStatus("reclaim", "in_progress", "unassigned")).toBe(true);
    expect(canTransitionTaskStatus("reclaim", "completed", "unassigned")).toBe(false);
    expect(canTransitionTaskStatus("reopen", "completed")).toBe(true);
    expect(canTransitionTaskStatus("reopen", "assigned")).toBe(false);
  });
});
