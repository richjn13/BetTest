import { describe, expect, it } from "vitest";
import { computeWeekStats, formatRecord, type StatGame, type StatPick } from "../week-stats";

const game = (over: Partial<StatGame> & { id: string }): StatGame => ({
  homeTeam: "Kansas City Chiefs",
  awayTeam: "Buffalo Bills",
  spread: -3,
  homeScore: 27,
  awayScore: 20,
  status: "final",
  ...over,
});

const pick = (over: Partial<StatPick> & { gameId: string }): StatPick => ({
  side: "home",
  isLock: false,
  points: 1,
  ...over,
});

describe("computeWeekStats", () => {
  it("counts a week as complete only when every game has resolved", () => {
    const games = [game({ id: "a" }), game({ id: "b", status: "scheduled", homeScore: null, awayScore: null })];
    expect(computeWeekStats(games, []).complete).toBe(false);
    expect(computeWeekStats([game({ id: "a" })], []).complete).toBe(true);
  });

  it("ignores postponed games when deciding completeness", () => {
    const games = [game({ id: "a" }), game({ id: "b", status: "postponed" })];
    const stats = computeWeekStats(games, []);
    expect(stats.complete).toBe(true);
    expect(stats.gamesTotal).toBe(1);
  });

  it("builds a record against the spread and totals the points", () => {
    const games = [
      game({ id: "a" }),                                    // home -3, wins by 7: home covers
      game({ id: "b", homeScore: 20, awayScore: 27 }),      // away covers
      game({ id: "c", spread: -7, homeScore: 27, awayScore: 20 }), // push
    ];
    const picks = [
      pick({ gameId: "a", points: 1 }),
      pick({ gameId: "b", points: 0 }),
      pick({ gameId: "c", points: 0 }),
    ];
    const stats = computeWeekStats(games, picks);
    expect(stats.record).toEqual({ wins: 1, losses: 1, pushes: 1 });
    expect(stats.points).toBe(1);
    expect(formatRecord(stats.record)).toBe("1-1-1");
  });

  it("reports what the lock did", () => {
    const games = [game({ id: "a" })];
    expect(computeWeekStats(games, [pick({ gameId: "a", isLock: true, points: 2 })]).lock).toBe("hit");
    expect(
      computeWeekStats(games, [pick({ gameId: "a", side: "away", isLock: true, points: 0 })]).lock,
    ).toBe("missed");
    expect(computeWeekStats(games, []).lock).toBe("none");
  });

  it("splits your picks by favourite and underdog", () => {
    const games = [
      game({ id: "a", spread: -3 }),                        // home favoured, home covers
      game({ id: "b", spread: 6, homeScore: 20, awayScore: 27 }), // home a dog, away covers
    ];
    const picks = [
      pick({ gameId: "a", side: "home", points: 1 }), // took the favourite, won
      pick({ gameId: "b", side: "home", points: 0 }), // took the dog, lost
    ];
    const stats = computeWeekStats(games, picks);
    const favourite = stats.splits.find((s) => s.label === "Taking the favourite");
    const underdog = stats.splits.find((s) => s.label === "Taking the underdog");
    expect(favourite?.record).toEqual({ wins: 1, losses: 0, pushes: 0 });
    expect(underdog?.record).toEqual({ wins: 0, losses: 1, pushes: 0 });
  });

  it("leaves out splits with nothing in them", () => {
    const stats = computeWeekStats([game({ id: "a" })], [pick({ gameId: "a" })]);
    expect(stats.splits.every((s) => s.record.wins + s.record.losses + s.record.pushes > 0)).toBe(true);
  });

  it("reports how home underdogs did, regardless of what you picked", () => {
    const games = [
      game({ id: "a", spread: 3, homeScore: 27, awayScore: 20 }),  // home dog covers
      game({ id: "b", spread: 6, homeScore: 10, awayScore: 30 }),  // home dog does not
    ];
    const stats = computeWeekStats(games, []);
    expect(stats.trends).toContain("Home underdogs went 1-1 against the spread.");
  });

  it("counts how often favourites covered", () => {
    const games = [
      game({ id: "a", spread: -3, homeScore: 27, awayScore: 20 }), // favourite covers
      game({ id: "b", spread: -7, homeScore: 21, awayScore: 20 }), // favourite does not
    ];
    expect(computeWeekStats(games, []).trends).toContain("Favourites covered 1 of 2.");
  });

  it("flags games decided close to the number", () => {
    const games = [game({ id: "a", spread: -3, homeScore: 24, awayScore: 20 })];
    expect(computeWeekStats(games, []).trends).toContain(
      "1 game landed within a field goal of the number.",
    );
  });

  it("names the biggest outright upset", () => {
    const games = [
      game({ id: "a", spread: -10, homeScore: 13, awayScore: 30 }), // away dog wins by 17
      game({ id: "b", spread: 4, homeScore: 24, awayScore: 21 }),   // home dog wins by 3
    ];
    const trend = computeWeekStats(games, []).trends.find((t) => t.startsWith("Biggest"));
    expect(trend).toBe("Biggest outright upset: Buffalo Bills won by 17 as the underdog.");
  });

  it("copes with a week nobody picked", () => {
    const stats = computeWeekStats([game({ id: "a" })], []);
    expect(stats.points).toBe(0);
    expect(stats.record).toEqual({ wins: 0, losses: 0, pushes: 0 });
    expect(stats.trends.length).toBeGreaterThan(0);
  });

  it("copes with an empty week", () => {
    const stats = computeWeekStats([], []);
    expect(stats.complete).toBe(false);
    expect(stats.trends).toEqual([]);
  });
});
