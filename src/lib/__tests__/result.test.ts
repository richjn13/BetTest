import { describe, expect, it } from "vitest";
import { consensusVerdict, describeOutcome, type OutcomeInput } from "../result";

const base: OutcomeInput = {
  homeTeam: "Kansas City Chiefs",
  awayTeam: "Buffalo Bills",
  finalHomeScore: 27,
  finalAwayScore: 24,
  spread: -2.5,
  status: "final",
  pickedSide: "home",
  isLock: false,
  points: 1,
};

describe("describeOutcome", () => {
  it("names the winner, the margin, and who covered", () => {
    const out = describeOutcome(base);
    expect(out.score).toBe("KC 27, BUF 24");
    expect(out.line).toBe("KC won by 3. KC -2.5 covered.");
    expect(out.covered).toBe("home");
  });

  it("explains a winning pick and what it scored", () => {
    expect(describeOutcome(base).effect).toBe("You had KC. +1 point.");
    expect(describeOutcome({ ...base, isLock: true, points: 2 }).effect).toBe(
      "You had KC as your lock. +2 points.",
    );
  });

  it("explains a losing pick without scolding", () => {
    const out = describeOutcome({ ...base, pickedSide: "away", points: 0 });
    expect(out.verdict).toBe("loss");
    expect(out.effect).toBe("You had BUF. No points.");
  });

  it("calls a push a push and says the lock was not penalised", () => {
    // Won by exactly 3 with the line at 3.
    const out = describeOutcome({ ...base, spread: -3, isLock: true, points: 0 });
    expect(out.verdict).toBe("push");
    expect(out.line).toBe("KC won by 3, landing exactly on the number (-3). Push.");
    expect(out.effect).toContain("no penalty for the lock");
  });

  it("reports the underdog covering", () => {
    // Home favoured by 7 but wins by 3, so the away side covers.
    const out = describeOutcome({ ...base, spread: -7, pickedSide: "away", points: 1 });
    expect(out.line).toBe("KC won by 3. BUF +7 covered.");
    expect(out.verdict).toBe("win");
  });

  it("puts the winning team first in the score line", () => {
    expect(describeOutcome({ ...base, finalHomeScore: 17, finalAwayScore: 31 }).score).toBe(
      "BUF 31, KC 17",
    );
  });

  it("handles a tie, where the side getting points covers", () => {
    // 20-20 with the home team laying 2.5 means the away side covers.
    const out = describeOutcome({ ...base, finalHomeScore: 20, finalAwayScore: 20 });
    expect(out.score).toContain("tied");
    expect(out.line).toBe("Tied. BUF +2.5 covered.");
    expect(out.covered).toBe("away");
  });

  it("says nothing conclusive while a game is still live", () => {
    const out = describeOutcome({ ...base, status: "live" });
    expect(out.verdict).toBe("pending");
    expect(out.score).toBe("KC 27, BUF 24");
    expect(out.line).toBeNull();
  });

  it("says a postponed game does not count", () => {
    const out = describeOutcome({ ...base, status: "postponed" });
    expect(out.verdict).toBe("none");
    expect(out.effect).toContain("does not count");
  });

  it("notes when no pick was made", () => {
    const out = describeOutcome({ ...base, pickedSide: null, points: null });
    expect(out.verdict).toBe("none");
    expect(out.effect).toBe("You did not pick this game.");
  });

  it("grades straight up when there was never a line", () => {
    const out = describeOutcome({ ...base, spread: null });
    expect(out.line).toBe("KC won by 3. No line was set.");
    expect(out.covered).toBe("home");
  });

  it("returns nothing before a score exists", () => {
    const out = describeOutcome({ ...base, finalHomeScore: null, finalAwayScore: null });
    expect(out.score).toBeNull();
    expect(out.verdict).toBe("pending");
  });
});

describe("consensusVerdict", () => {
  it("reports how many of the group got it right, as a percentage", () => {
    expect(consensusVerdict({ total: 5, home: 3, away: 2 }, "home")).toEqual({
      right: 3,
      total: 5,
      percent: 60,
    });
    expect(consensusVerdict({ total: 5, home: 3, away: 2 }, "away")).toEqual({
      right: 2,
      total: 5,
      percent: 40,
    });
  });

  it("handles everyone right and everyone wrong", () => {
    expect(consensusVerdict({ total: 4, home: 4, away: 0 }, "home")).toMatchObject({ percent: 100 });
    expect(consensusVerdict({ total: 4, home: 4, away: 0 }, "away")).toMatchObject({ percent: 0 });
  });

  it("rounds to whole percent", () => {
    expect(consensusVerdict({ total: 3, home: 1, away: 2 }, "home")).toMatchObject({ percent: 33 });
    expect(consensusVerdict({ total: 3, home: 2, away: 1 }, "home")).toMatchObject({ percent: 67 });
  });

  it("calls a push a push rather than a percentage", () => {
    expect(consensusVerdict({ total: 5, home: 3, away: 2 }, "push")).toBe("push");
  });

  it("returns nothing when the game is undecided or nobody picked", () => {
    expect(consensusVerdict({ total: 5, home: 3, away: 2 }, null)).toBeNull();
    expect(consensusVerdict({ total: 0, home: 0, away: 0 }, "home")).toBeNull();
  });
});
