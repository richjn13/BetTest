import { describe, expect, it } from "vitest";
import {
  isSaturdayGame,
  ncaafSeasonStartUtc,
  ncaafWeekForKickoff,
  seasonStartUtc,
  seasonYearFor,
  weekForKickoff,
  weekForSport,
} from "../season-week";

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

describe("college football weeks", () => {
  it("anchors week 1 on the weekend that ends on Labor Day", () => {
    // Week 1's Saturday is the Saturday before the first Monday of September,
    // and the week opens on the Tuesday before it, as an NFL week does.
    // 2026: Labor Day is 7 September, so week 1 is Saturday the 5th.
    expect(new Date(ncaafSeasonStartUtc(2026)).toISOString().slice(0, 10)).toBe("2026-09-01");
    // 2025: Labor Day is 1 September, so week 1 is Saturday 30 August.
    expect(new Date(ncaafSeasonStartUtc(2025)).toISOString().slice(0, 10)).toBe("2025-08-26");
  });

  it("counts Saturdays from the opener", () => {
    expect(ncaafWeekForKickoff(at("2026-09-05T18:00:00Z"))).toEqual({
      seasonYear: 2026,
      weekNumber: 1,
    });
    expect(ncaafWeekForKickoff(at("2026-09-12T18:00:00Z")).weekNumber).toBe(2);
    expect(ncaafWeekForKickoff(at("2026-09-19T18:00:00Z")).weekNumber).toBe(3);
  });

  it("numbers the late August openers week 0, as college itself does", () => {
    expect(ncaafWeekForKickoff(at("2026-08-29T18:00:00Z"))).toEqual({
      seasonYear: 2026,
      weekNumber: 0,
    });
    expect(ncaafWeekForKickoff(at("2025-08-23T18:00:00Z"))).toEqual({
      seasonYear: 2025,
      weekNumber: 0,
    });
  });

  it("keeps a late kickoff with its own Saturday", () => {
    // A west coast game starting 8pm Pacific is Sunday 03:00 UTC.
    expect(ncaafWeekForKickoff(at("2026-09-13T03:00:00Z")).weekNumber).toBe(2);
  });

  it("puts January games in the season that started the previous August", () => {
    expect(ncaafWeekForKickoff(at("2027-01-09T00:00:00Z")).seasonYear).toBe(2026);
  });
});

describe("isSaturdayGame", () => {
  it("accepts Saturday afternoon through the late window", () => {
    expect(isSaturdayGame(at("2026-09-05T16:00:00Z"))).toBe(true);  // noon ET
    expect(isSaturdayGame(at("2026-09-05T23:30:00Z"))).toBe(true);  // evening ET
    expect(isSaturdayGame(at("2026-09-06T03:00:00Z"))).toBe(true);  // late, west coast
  });

  it("rejects a Thursday or Friday game", () => {
    expect(isSaturdayGame(at("2026-09-03T23:00:00Z"))).toBe(false);
    expect(isSaturdayGame(at("2026-09-04T23:00:00Z"))).toBe(false);
  });

  it("rejects Sunday proper, which is the NFL", () => {
    expect(isSaturdayGame(at("2026-09-06T17:00:00Z"))).toBe(false);
  });

  it("rejects Saturday morning UTC, which is Friday night in the US", () => {
    expect(isSaturdayGame(at("2026-09-05T02:00:00Z"))).toBe(false);
  });
});

describe("weekForSport", () => {
  it("routes each sport to its own calendar", () => {
    // The same Saturday is a different week number in each sport: college's
    // week 1 ends on Labor Day, the NFL's starts two days after it.
    const saturday = at("2026-09-19T18:00:00Z");
    expect(weekForSport(saturday, "ncaaf").weekNumber).toBe(3);
    expect(weekForSport(saturday, "nfl").weekNumber).toBe(2);
  });
});
