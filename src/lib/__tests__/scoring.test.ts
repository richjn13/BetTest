import { describe, expect, it } from "vitest";
import {
  buildStandings,
  coverMargin,
  gradePick,
  gradeTotalPick,
  winningSide,
  winningTotal,
  type GradableGame,
} from "../scoring";

const finalGame = (
  homeScore: number,
  awayScore: number,
  frozenHomeSpread: number | null,
): GradableGame => ({
  status: "final",
  finalHomeScore: homeScore,
  finalAwayScore: awayScore,
  frozenHomeSpread,
});

describe("coverMargin", () => {
  it("treats a negative home spread as the home team being favored", () => {
    // Home favored by 3.5, wins by 7 -> covers by 3.5.
    expect(coverMargin(24, 17, -3.5)).toBe(3.5);
    // Home favored by 3.5, wins by 3 -> fails to cover.
    expect(coverMargin(20, 17, -3.5)).toBe(-0.5);
  });

  it("treats a positive home spread as the home team getting points", () => {
    expect(coverMargin(17, 20, 6.5)).toBe(3.5);
  });
});

describe("winningSide", () => {
  it("returns a push when the margin lands exactly on the number", () => {
    expect(winningSide(finalGame(24, 21, -3))).toBe("push");
  });

  it("grades straight up when no line was ever recorded", () => {
    expect(winningSide(finalGame(24, 21, null))).toBe("home");
    expect(winningSide(finalGame(21, 21, null))).toBe("push");
  });

  it("returns null without a final score", () => {
    expect(winningSide({ ...finalGame(0, 0, -3), finalHomeScore: null })).toBeNull();
  });
});

describe("gradePick", () => {
  it("awards 1 point for a correct pick", () => {
    expect(gradePick({ pickedSide: "home", isLock: false }, finalGame(24, 17, -3.5)))
      .toEqual({ points: 1, result: "win" });
  });

  it("awards 2 points for a correct lock", () => {
    expect(gradePick({ pickedSide: "home", isLock: true }, finalGame(24, 17, -3.5)))
      .toEqual({ points: 2, result: "win" });
  });

  it("awards nothing for an incorrect pick, locked or not", () => {
    expect(gradePick({ pickedSide: "away", isLock: false }, finalGame(24, 17, -3.5)))
      .toEqual({ points: 0, result: "loss" });
    expect(gradePick({ pickedSide: "away", isLock: true }, finalGame(24, 17, -3.5)))
      .toEqual({ points: 0, result: "loss" });
  });

  it("gives a push zero points with no lock penalty or bonus", () => {
    for (const isLock of [false, true]) {
      for (const pickedSide of ["home", "away"] as const) {
        expect(gradePick({ pickedSide, isLock }, finalGame(24, 21, -3)))
          .toEqual({ points: 0, result: "push" });
      }
    }
  });

  it("excludes postponed and canceled games instead of scoring them", () => {
    for (const status of ["postponed", "canceled"] as const) {
      expect(
        gradePick(
          { pickedSide: "home", isLock: true },
          { ...finalGame(24, 17, -3.5), status },
        ),
      ).toBeNull();
    }
  });

  it("leaves scheduled and live games ungraded", () => {
    for (const status of ["scheduled", "live"] as const) {
      expect(
        gradePick(
          { pickedSide: "home", isLock: false },
          { ...finalGame(24, 17, -3.5), status },
        ),
      ).toBeNull();
    }
  });
});

describe("buildStandings", () => {
  const w1 = "week-1";
  const w2 = "week-2";

  it("totals points across weeks and keeps a per-week breakdown", () => {
    const standings = buildStandings(
      ["ann", "bob"],
      [
        { userId: "ann", weekId: w1, points: 2, isLock: true, result: "win" },
        { userId: "ann", weekId: w1, points: 1, isLock: false, result: "win" },
        { userId: "ann", weekId: w2, points: 0, isLock: false, result: "loss" },
        { userId: "bob", weekId: w1, points: 1, isLock: false, result: "win" },
      ],
    );

    expect(standings.map((s) => s.userId)).toEqual(["ann", "bob"]);
    expect(standings[0].totalPoints).toBe(3);
    expect(standings[0].weeks.find((w) => w.weekId === w1)?.points).toBe(3);
    expect(standings[0].weeks.find((w) => w.weekId === w2)?.points).toBe(0);
  });

  it("breaks a points tie by most correct non-lock picks", () => {
    const standings = buildStandings(
      ["ann", "bob"],
      [
        // Ann: one correct lock, worth 2.
        { userId: "ann", weekId: w1, points: 2, isLock: true, result: "win" },
        // Bob: two correct ordinary picks, also worth 2.
        { userId: "bob", weekId: w1, points: 1, isLock: false, result: "win" },
        { userId: "bob", weekId: w1, points: 1, isLock: false, result: "win" },
      ],
    );

    expect(standings.map((s) => s.userId)).toEqual(["bob", "ann"]);
    expect(standings[0].totalPoints).toBe(2);
    expect(standings[0].correctNonLock).toBe(2);
  });

  it("counts ungraded picks as pending rather than as zeros", () => {
    const standings = buildStandings(
      ["ann"],
      [{ userId: "ann", weekId: w1, points: null, isLock: false, result: null }],
    );
    expect(standings[0].totalPoints).toBe(0);
    expect(standings[0].weeks[0]).toMatchObject({ graded: 0, pending: 1 });
  });

  it("applies manual adjustments to the season and to the named week", () => {
    const standings = buildStandings(
      ["ann"],
      [{ userId: "ann", weekId: w1, points: 1, isLock: false, result: "win" }],
      [
        { userId: "ann", weekId: w1, points: 2 },
        { userId: "ann", weekId: null, points: -1 },
      ],
    );
    expect(standings[0].totalPoints).toBe(2);
    expect(standings[0].weeks[0].points).toBe(3);
  });

  it("includes members who have not picked at all", () => {
    const standings = buildStandings(["ann", "bob"], []);
    expect(standings).toHaveLength(2);
    expect(standings.every((s) => s.totalPoints === 0)).toBe(true);
  });
});

describe("winningTotal", () => {
  it("compares the combined score against the line", () => {
    expect(winningTotal(24, 21, 44.5)).toBe("over");
    expect(winningTotal(17, 14, 44.5)).toBe("under");
  });

  it("returns a push when the combined score lands on the number", () => {
    expect(winningTotal(24, 20, 44)).toBe("push");
  });
});

describe("gradeTotalPick", () => {
  const final = (home: number, away: number, total: number | null) => ({
    status: "final" as const,
    finalHomeScore: home,
    finalAwayScore: away,
    frozenTotal: total,
  });

  it("awards a point for a correct over or under", () => {
    expect(gradeTotalPick("over", final(24, 21, 44.5))).toEqual({ points: 1, result: "win" });
    expect(gradeTotalPick("under", final(17, 14, 44.5))).toEqual({ points: 1, result: "win" });
  });

  it("awards nothing for a wrong call", () => {
    expect(gradeTotalPick("under", final(24, 21, 44.5))).toEqual({ points: 0, result: "loss" });
  });

  it("never pays more than one, so a total cannot be doubled", () => {
    const graded = gradeTotalPick("over", final(35, 35, 44.5));
    expect(graded?.points).toBe(1);
  });

  it("scores a push at zero", () => {
    expect(gradeTotalPick("over", final(24, 20, 44))).toEqual({ points: 0, result: "push" });
    expect(gradeTotalPick("under", final(24, 20, 44))).toEqual({ points: 0, result: "push" });
  });

  it("leaves an unfinished or excluded game ungraded", () => {
    expect(gradeTotalPick("over", { ...final(24, 21, 44.5), status: "live" })).toBeNull();
    expect(gradeTotalPick("over", { ...final(24, 21, 44.5), status: "postponed" })).toBeNull();
  });

  it("cannot grade without a frozen total", () => {
    expect(gradeTotalPick("over", final(24, 21, null))).toBeNull();
  });
})
