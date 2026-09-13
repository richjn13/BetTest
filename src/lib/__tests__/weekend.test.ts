import { describe, expect, it } from "vitest";
import { groupIntoWeekends, weekendKey, weekendStartUtc, type WeekLike } from "../weekend";

const week = (
  id: string,
  sport: "nfl" | "ncaaf",
  seasonYear: number,
  weekNumber: number,
): WeekLike => ({ id, sport, season_year: seasonYear, week_number: weekNumber, label: `Week ${weekNumber}` });

describe("weekendStartUtc", () => {
  it("anchors on the Tuesday before", () => {
    // Saturday 12 September 2026 belongs to the week opening Tuesday the 8th.
    expect(new Date(weekendStartUtc(new Date("2026-09-12T20:00:00Z"))).toISOString()).toBe(
      "2026-09-08T08:00:00.000Z",
    );
  });

  it("keeps a late west coast game with its own Saturday", () => {
    // Sunday 03:00 UTC is Saturday night in the United States.
    expect(new Date(weekendStartUtc(new Date("2026-09-13T03:00:00Z"))).toISOString()).toBe(
      "2026-09-08T08:00:00.000Z",
    );
  });

  it("starts a new weekend on Tuesday morning", () => {
    expect(new Date(weekendStartUtc(new Date("2026-09-15T09:00:00Z"))).toISOString()).toBe(
      "2026-09-15T08:00:00.000Z",
    );
  });
});

describe("weekendKey", () => {
  it("gives NFL week 1 and college week 2 the same weekend", () => {
    // 2026: college week 2 is Saturday 12 September, NFL week 1 the 13th.
    expect(weekendKey(week("a", "ncaaf", 2026, 2))).toBe(weekendKey(week("b", "nfl", 2026, 1)));
  });

  it("keeps different weekends apart", () => {
    expect(weekendKey(week("a", "nfl", 2026, 1))).not.toBe(weekendKey(week("b", "nfl", 2026, 2)));
  });
});

describe("groupIntoWeekends", () => {
  it("folds both competitions into one numbered weekend", () => {
    const weekends = groupIntoWeekends([
      week("nfl1", "nfl", 2026, 1),
      week("ncaa2", "ncaaf", 2026, 2),
      week("nfl2", "nfl", 2026, 2),
      week("ncaa3", "ncaaf", 2026, 3),
    ]);

    expect(weekends).toHaveLength(2);
    expect(weekends[0].number).toBe(1);
    expect(weekends[0].weeks.map((entry) => entry.id).sort()).toEqual(["ncaa2", "nfl1"]);
    expect(weekends[1].weeks.map((entry) => entry.id).sort()).toEqual(["ncaa3", "nfl2"]);
  });

  it("numbers by the pool's own order, earliest first", () => {
    const weekends = groupIntoWeekends([
      week("later", "nfl", 2026, 3),
      week("earlier", "nfl", 2026, 1),
    ]);
    expect(weekends.map((entry) => entry.weeks[0].id)).toEqual(["earlier", "later"]);
    expect(weekends.map((entry) => entry.number)).toEqual([1, 2]);
  });

  it("handles a weekend only one competition played", () => {
    const weekends = groupIntoWeekends([week("solo", "ncaaf", 2026, 0)]);
    expect(weekends).toHaveLength(1);
    expect(weekends[0].weeks).toHaveLength(1);
  });
});
