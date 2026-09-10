import { describe, expect, it } from "vitest";
import { seasonStartUtc, seasonYearFor, weekForKickoff } from "../nfl-week";

const at = (iso: string) => new Date(iso);

describe("seasonStartUtc", () => {
  it("lands on the Tuesday after the first Monday in September", () => {
    // Labor Day 2025 was Monday September 1, so Week 1 opens Tuesday the 2nd.
    expect(new Date(seasonStartUtc(2025)).toISOString()).toBe("2025-09-02T08:00:00.000Z");
    // Labor Day 2024 was Monday September 2.
    expect(new Date(seasonStartUtc(2024)).toISOString()).toBe("2024-09-03T08:00:00.000Z");
    // September 2026 starts on a Tuesday; the first Monday is the 7th.
    expect(new Date(seasonStartUtc(2026)).toISOString()).toBe("2026-09-08T08:00:00.000Z");
  });
});

describe("weekForKickoff", () => {
  it("puts the Thursday opener in week 1", () => {
    expect(weekForKickoff(at("2025-09-05T00:20:00Z"))).toEqual({
      seasonYear: 2025,
      weekNumber: 1,
    });
  });

  it("keeps Sunday and Monday night in the same week as the Thursday game", () => {
    expect(weekForKickoff(at("2025-09-07T17:00:00Z")).weekNumber).toBe(1);
    // Monday night kicks off late enough to fall on Tuesday UTC.
    expect(weekForKickoff(at("2025-09-09T00:15:00Z")).weekNumber).toBe(1);
  });

  it("rolls to the next week after the Tuesday boundary", () => {
    expect(weekForKickoff(at("2025-09-09T08:00:00Z")).weekNumber).toBe(2);
    expect(weekForKickoff(at("2025-09-11T00:15:00Z")).weekNumber).toBe(2);
  });

  it("reaches week 18 at the end of the regular season", () => {
    expect(weekForKickoff(at("2026-01-04T18:00:00Z"))).toEqual({
      seasonYear: 2025,
      weekNumber: 18,
    });
  });

  it("numbers the playoff rounds 19 through 22", () => {
    expect(weekForKickoff(at("2026-01-11T18:00:00Z")).weekNumber).toBe(19);
    expect(weekForKickoff(at("2026-01-18T18:00:00Z")).weekNumber).toBe(20);
    expect(weekForKickoff(at("2026-01-25T20:00:00Z")).weekNumber).toBe(21);
    // The Super Bowl sits two weeks after the conference championships; the
    // extra bye week is folded back so it still lands on 22.
    expect(weekForKickoff(at("2026-02-08T23:30:00Z")).weekNumber).toBe(22);
  });

  it("assigns January games to the season that started the previous autumn", () => {
    expect(seasonYearFor(at("2026-01-11T18:00:00Z"))).toBe(2025);
    expect(seasonYearFor(at("2025-09-05T00:20:00Z"))).toBe(2025);
  });
});
