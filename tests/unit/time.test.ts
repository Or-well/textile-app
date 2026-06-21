import { describe, expect, it } from "vitest";
import {
  compareInstants,
  formatDateTimeLocalInput,
  getZonedDateTimeCandidates,
  normalizeInstant,
  utcDateKey,
  zonedDateTimeToUtc,
} from "../../src/utils/time";

describe("time utilities", () => {
  it("normalizes absolute instants and rejects timezone-free values", () => {
    expect(normalizeInstant("2026-06-21T18:00:00+09:00")).toBe(
      "2026-06-21T09:00:00.000Z",
    );
    expect(normalizeInstant("2026-06-21T18:00")).toBe("");
  });

  it("converts local wall time using an IANA timezone", () => {
    const instant = zonedDateTimeToUtc(
      "2026-06-21T18:00",
      "Asia/Tokyo",
    );

    expect(instant).toBe("2026-06-21T09:00:00.000Z");
    expect(formatDateTimeLocalInput(instant, "America/New_York")).toBe(
      "2026-06-21T05:00",
    );
  });

  it("rejects nonexistent daylight-saving times", () => {
    expect(() =>
      zonedDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
    ).toThrow("不存在");
  });

  it("requires disambiguation for repeated daylight-saving times", () => {
    const candidates = getZonedDateTimeCandidates(
      "2026-11-01T01:30",
      "America/New_York",
    );

    expect(candidates).toEqual([
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
    expect(() =>
      zonedDateTimeToUtc("2026-11-01T01:30", "America/New_York"),
    ).toThrow("出现两次");
    expect(
      zonedDateTimeToUtc(
        "2026-11-01T01:30",
        "America/New_York",
        "later",
      ),
    ).toBe("2026-11-01T06:30:00.000Z");
  });

  it("sorts invalid values after valid instants and uses UTC date keys", () => {
    expect(
      ["invalid", "2026-06-21T09:00:00Z", "2026-06-20T10:00:00Z"].sort(
        compareInstants,
      ),
    ).toEqual([
      "2026-06-20T10:00:00Z",
      "2026-06-21T09:00:00Z",
      "invalid",
    ]);
    expect(utcDateKey("2026-06-21T00:30:00+09:00")).toBe("2026-06-20");
  });
});
