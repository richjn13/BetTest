import { describe, expect, it } from "vitest";
import { validate } from "../claude-odds-validate";
import { seasonStartUtc } from "../nfl-week";

// Week 2 of 2026 opens a week after the season start.
const SEASON = 2026;
const WEEK = 2;
const weekStart = seasonStartUtc(SEASON) + 7 * 86_400_000;
const kickoff = (offsetDays = 3) =>
  new Date(weekStart + offsetDays * 86_400_000).toISOString();

const game = (over: Record<string, unknown> = {}) => ({
  away_team: "Buffalo Bills",
  home_team: "Kansas City Chiefs",
  kickoff_iso: kickoff(),
  home_spread: -2.5,
  ...over,
});

const run = (games: unknown[], source = "DraftKings") =>
  validate({ games, source }, SEASON, WEEK);

describe("validate", () => {
  it("accepts a well-formed game and keeps the source", () => {
    const result = run([game()]);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("DraftKings");
    expect(result.games).toEqual([
      {
        awayTeam: "Buffalo Bills",
        homeTeam: "Kansas City Chiefs",
        kickoffIso: kickoff(),
        homeSpread: -2.5,
      },
    ]);
  });

  it("resolves team names regardless of case and stray spacing", () => {
    const result = run([game({ away_team: "  buffalo BILLS " })]);
    expect(result.games[0].awayTeam).toBe("Buffalo Bills");
  });

  it("rejects a name that is not an NFL team", () => {
    const result = run([game({ home_team: "Kansas City Chefs" })]);
    expect(result.games).toHaveLength(0);
    expect(result.rejected[0]).toContain("not a recognized NFL team");
  });

  it("rejects a team playing itself", () => {
    const result = run([game({ away_team: "Kansas City Chiefs" })]);
    expect(result.rejected[0]).toContain("cannot play itself");
  });

  it("rejects a spread that is not a half point", () => {
    // A misread decimal is the failure this catches.
    const result = run([game({ home_spread: -3.25 })]);
    expect(result.rejected[0]).toContain("not a half point");
  });

  it("accepts whole and half point spreads on both sides", () => {
    const result = run([
      game({ home_spread: -7 }),
      game({ away_team: "New York Jets", home_spread: 6.5 }),
      game({ away_team: "Chicago Bears", home_spread: 0 }),
    ]);
    expect(result.games.map((g) => g.homeSpread)).toEqual([-7, 6.5, 0]);
  });

  it("rejects an implausibly large spread", () => {
    // A moneyline reported as a spread looks like this.
    const result = run([game({ home_spread: -145 })]);
    expect(result.rejected[0]).toContain("implausible");
  });

  it("rejects a spread that is not a number", () => {
    const result = run([game({ home_spread: "off" })]);
    expect(result.rejected[0]).toContain("not a number");
  });

  it("rejects an unreadable kickoff time", () => {
    const result = run([game({ kickoff_iso: "Sunday afternoon" })]);
    expect(result.rejected[0]).toContain("could not be read");
  });

  it("rejects a kickoff belonging to another week", () => {
    const result = run([game({ kickoff_iso: kickoff(30) })]);
    expect(result.rejected[0]).toContain("not week 2");
  });

  it("accepts the Super Bowl, which sits two weeks past its nominal start", () => {
    // The bye before the Super Bowl means a fixed day window around week 22's
    // start rejects it. Validation asks weekForKickoff instead, which folds it
    // back onto 22 exactly as the rest of the app does.
    const result = validate(
      {
        games: [
          {
            away_team: "Kansas City Chiefs",
            home_team: "Philadelphia Eagles",
            kickoff_iso: "2026-02-08T23:30:00Z",
            home_spread: -1.5,
          },
        ],
        source: "DraftKings",
      },
      2025,
      22,
    );
    expect(result.rejected).toEqual([]);
    expect(result.games).toHaveLength(1);
  });

  it("accepts the earlier playoff rounds in their own weeks", () => {
    const rounds: [string, number][] = [
      ["2026-01-11T18:00:00Z", 19],
      ["2026-01-18T18:00:00Z", 20],
      ["2026-01-25T20:00:00Z", 21],
    ];
    for (const [iso, week] of rounds) {
      const result = validate(
        {
          games: [
            {
              away_team: "Buffalo Bills",
              home_team: "Kansas City Chiefs",
              kickoff_iso: iso,
              home_spread: -3,
            },
          ],
          source: "DraftKings",
        },
        2025,
        week,
      );
      expect(result.rejected).toEqual([]);
      expect(result.games).toHaveLength(1);
    }
  });

  it("keeps the first of a duplicated matchup and names the rest", () => {
    const result = run([game({ home_spread: -2.5 }), game({ home_spread: -7 })]);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].homeSpread).toBe(-2.5);
    expect(result.rejected[0]).toContain("more than once");
  });

  it("keeps good rows when others fail, rather than discarding everything", () => {
    const result = run([
      game(),
      game({ away_team: "Not A Team", home_team: "Chicago Bears" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.games).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("fails when nothing survives", () => {
    const result = run([game({ home_spread: -145 })]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("passed validation");
  });

  it("fails when the reply has no games list at all", () => {
    expect(validate({ source: "x" }, SEASON, WEEK).ok).toBe(false);
    expect(validate(null, SEASON, WEEK).ok).toBe(false);
  });
});
