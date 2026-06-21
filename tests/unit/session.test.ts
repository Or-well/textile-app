import { describe, expect, it, vi } from "vitest";
import {
  isSessionExpired,
  saveProjectSession,
} from "../../src/services/session";

describe("project sessions", () => {
  it("uses an exact elapsed duration for remembered sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T06:30:00.000Z"));

    const session = saveProjectSession("project-1", "member-1", 1);

    expect(session.expiresAt).toBe("2026-03-09T06:30:00.000Z");
    vi.useRealTimers();
  });

  it("treats invalid expiry timestamps as expired", () => {
    expect(
      isSessionExpired({
        projectId: "project-1",
        userId: "member-1",
        loginAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "invalid",
      }),
    ).toBe(true);
  });
});
