import { describe, expect, it } from "vitest";
import {
  countPicked,
  gameSetKey,
  initialSelections,
  withLockOn,
} from "../selections";
import type { GameCard, Pick } from "../types";

const card = (id: string, pick?: Partial<Pick>): GameCard =>
  ({
    game: { id } as GameCard["game"],
    pick: pick
      ? ({ picked_side: "home", is_lock: false, ...pick } as Pick)
      : null,
    isOpen: true,
    revealed: null,
    consensus: null,
  }) as GameCard;

describe("initialSelections", () => {
  it("carries each existing pick across", () => {
    const selections = initialSelections([
      card("a", { picked_side: "away", is_lock: true }),
      card("b"),
    ]);
    expect(selections).toEqual({
      a: { side: "away", isLock: true, total: null },
      b: { side: null, isLock: false, total: null },
    });
  });

  it("has exactly one entry per game, so a count can never exceed the total", () => {
    const cards = [card("a", {}), card("b", {}), card("c")];
    const selections = initialSelections(cards);
    expect(Object.keys(selections)).toHaveLength(cards.length);
    expect(countPicked(selections)).toBeLessThanOrEqual(cards.length);
  });
});

describe("gameSetKey", () => {
  it("differs between two weeks, which is what triggers a rebuild", () => {
    // The bug this guards: a board holding week one's fifteen picks while
    // rendering week three's fourteen games, reading "15 of 14".
    const weekOne = [card("a"), card("b"), card("c")];
    const weekThree = [card("x"), card("y")];
    expect(gameSetKey(weekOne)).not.toBe(gameSetKey(weekThree));
  });

  it("is stable when the same games arrive in a different order", () => {
    expect(gameSetKey([card("a"), card("b")])).toBe(gameSetKey([card("b"), card("a")]));
  });

  it("changes when a game is added or removed", () => {
    expect(gameSetKey([card("a")])).not.toBe(gameSetKey([card("a"), card("b")]));
  });
});

describe("countPicked", () => {
  it("counts only games with a side chosen", () => {
    expect(countPicked({})).toBe(0);
    expect(
      countPicked({
        a: { side: "home", isLock: false, total: null },
        b: { side: null, isLock: false, total: null },
      }),
    ).toBe(1);
  });
});

describe("withLockOn", () => {
  const base = {
    a: { side: "home" as const, isLock: true, total: null },
    b: { side: "away" as const, isLock: false, total: "over" as const },
    c: { side: null, isLock: false, total: null },
  };

  it("moves the lock, leaving only one", () => {
    const next = withLockOn(base, "b", true);
    expect(next.a.isLock).toBe(false);
    expect(next.b.isLock).toBe(true);
    expect(Object.values(next).filter((entry) => entry.isLock)).toHaveLength(1);
  });

  it("does not disturb the sides already chosen", () => {
    const next = withLockOn(base, "b", true);
    expect(next.a.side).toBe("home");
    expect(next.b.side).toBe("away");
  });

  it("leaves the over/under picks alone, since the lock is a spread pick", () => {
    const next = withLockOn(base, "a", true);
    expect(next.b.total).toBe("over");
  });

  it("takes the home side when locking a game with no pick yet", () => {
    expect(withLockOn(base, "c", true).c).toEqual({ side: "home", isLock: true, total: null });
  });

  it("clears the lock without touching anything else", () => {
    const next = withLockOn(base, "a", false);
    expect(Object.values(next).some((entry) => entry.isLock)).toBe(false);
    expect(next.a.side).toBe("home");
  });
});
