import { describe, expect, it, vi } from "vitest";
import type { ProjectEvent } from "../../src/model/types";
import {
  EVENT_LOG_CHUNK_SIZE,
  findProjectEventFromNewest,
  loadProjectEventsFromStorage,
  planReplaceProjectEvents,
} from "../../src/services/eventLog";
import { appendEventToStorage } from "../../src/services/history";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createProjectWritePlan } from "../../src/services/projectWritePlan";

function createEvent(index: number): ProjectEvent {
  return {
    id: `event-${String(index).padStart(6, "0")}`,
    type: "entry.updated",
    user_id: "user-1",
    created_at: new Date(index * 1000).toISOString(),
    detail: {},
  };
}

describe("event log chunking", () => {
  it("keeps legacy logs readable and archives a full active chunk", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    const legacyEvents = Array.from(
      { length: EVENT_LOG_CHUNK_SIZE },
      (_, index) => createEvent(index),
    );
    await storage.writeJsonl("logs/events.jsonl", legacyEvents);

    const appended = await appendEventToStorage(storage, {
      type: "entry.updated",
      user_id: "user-1",
      detail: {},
    });

    await expect(
      storage.readJsonl<ProjectEvent>("logs/events/chunk_000001.jsonl"),
    ).resolves.toEqual(legacyEvents);
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual([appended]);
    await expect(loadProjectEventsFromStorage(storage)).resolves.toEqual([
      ...legacyEvents,
      appended,
    ]);
  });

  it("appends without reading archived chunks", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    await storage.writeJsonl("logs/events/chunk_000001.jsonl", [createEvent(0)]);
    await storage.writeJsonl("logs/events.jsonl", [createEvent(1)]);
    const readJsonl = vi.spyOn(storage, "readJsonl");

    await appendEventToStorage(storage, {
      type: "entry.updated",
      user_id: "user-1",
      detail: {},
    });

    expect(
      readJsonl.mock.calls.some(
        ([path]) => path === "logs/events/chunk_000001.jsonl",
      ),
    ).toBe(false);
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toHaveLength(2);
  });

  it("finds a recent event without reading archived chunks", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    const archived = createEvent(0);
    const active = createEvent(1);
    await storage.writeJsonl("logs/events/chunk_000001.jsonl", [archived]);
    await storage.writeJsonl("logs/events.jsonl", [active]);
    const readJsonl = vi.spyOn(storage, "readJsonl");

    await expect(
      findProjectEventFromNewest(storage, (event) => event.id === active.id),
    ).resolves.toEqual(active);
    expect(
      readJsonl.mock.calls.some(
        ([path]) => path === "logs/events/chunk_000001.jsonl",
      ),
    ).toBe(false);
  });

  it("replaces the complete log and removes surplus archive chunks", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    await storage.writeJsonl("logs/events/chunk_000001.jsonl", [createEvent(0)]);
    await storage.writeJsonl("logs/events/chunk_000002.jsonl", [createEvent(1)]);
    await storage.writeJsonl("logs/events.jsonl", [createEvent(2)]);
    const replacement = Array.from({ length: 1_500 }, (_, index) =>
      createEvent(index + 10),
    );
    const writePlan = createProjectWritePlan(storage);

    await planReplaceProjectEvents(writePlan, storage, replacement);
    await writePlan.execute();

    await expect(loadProjectEventsFromStorage(storage)).resolves.toEqual(
      replacement,
    );
    await expect(
      storage.fileExists("logs/events/chunk_000002.jsonl"),
    ).resolves.toBe(false);
  });
});
