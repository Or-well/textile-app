import { describe, expect, it } from "vitest";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "../../src/model/status";
import {
  canTransitionTaskStatus,
  getTaskStatusTransitionTargets,
  normalizeLegacyTaskStatus,
} from "../../src/model/taskStatus";

describe("task status transitions", () => {
  it("retires in_progress while keeping old task inputs compatible", () => {
    expect(TASK_STATUSES).toEqual(["unassigned", "assigned", "submitted", "completed"]);
    expect(TASK_STATUS_LABELS.in_progress).toBe("已分配");
    expect(normalizeLegacyTaskStatus("in_progress")).toBe("assigned");
    expect(canTransitionTaskStatus("submit", "in_progress", "submitted")).toBe(true);
    expect(getTaskStatusTransitionTargets("cancel_submit", "submitted")).toEqual(["assigned", "unassigned"]);
    expect(getTaskStatusTransitionTargets("reopen", "completed")).toEqual(["assigned", "unassigned"]);
  });
  it("exposes the same valid actions used by task services and UI", () => {
    expect(canTransitionTaskStatus("complete", "submitted", "completed")).toBe(true);
    expect(canTransitionTaskStatus("complete", "assigned", "completed")).toBe(false);
    expect(canTransitionTaskStatus("reclaim", "in_progress", "unassigned")).toBe(true);
    expect(canTransitionTaskStatus("reclaim", "completed", "unassigned")).toBe(false);
    expect(canTransitionTaskStatus("reopen", "completed")).toBe(true);
    expect(canTransitionTaskStatus("reopen", "assigned")).toBe(false);
  });
});
