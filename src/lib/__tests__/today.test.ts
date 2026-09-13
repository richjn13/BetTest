import { describe, expect, it } from "vitest";
import { dayStartUtc, sportInPlay, type DaySlate } from "../today";

const game = (kickoff: string, status = "scheduled") => ({ kickoff, status });

const slates = (
  ncaaf: { kickoff: string; status?: string }[],
  nfl: { kickoff: string; status?: string }[],
): DaySlate[] => [
  { sport: "ncaaf", games: ncaaf.map((g) => game(g.kickoff, g.status)) },
  { sport: "nfl", games: nfl.map((g) => game(g.kickoff, g.status)) },
];

describe("dayStartUtc", () => {
  it("starts the day at 08:00 UTC", () => {
    expect(new Date(dayStartUtc(new Date("2026-09-12T20:00:00Z"))).toISOString()).toBe(
      "2026-09-12T08:00:00.000Z",
    );
  });

  it("keeps a Saturday night game on Saturday", () => {
    // 01:00 UTC Sunday is 9pm Eastern on Saturday.
    expect(new Date(dayStartUtc(new Date("2026-09-13T01:00:00Z"))).toISOString()).toBe(
      "2026-09-12T08:00:00.000Z",
    );
  });
});

describe("sportInPlay", () => {
  it("opens on college on a Saturday afternoon", () => {
    const now = new Date("2026-09-12T18:00:00Z");
    expect(sportInPlay(slates([{ kickoff: "2026-09-12T16:00:00Z" }], []), now)).toBe("ncaaf");
  });

  it("opens on the NFL on a Sunday afternoon", () => {
    const now = new Date("2026-09-13T18:00:00Z");
    expect(sportInPlay(slates([], [{ kickoff: "2026-09-13T17:00:00Z" }]), now)).toBe("nfl");
  });

  it("prefers a game under way over one still to come", () => {
    const now = new Date("2026-09-12T23:00:00Z");
    const chosen = sportInPlay(
      slates(
        [{ kickoff: "2026-09-12T20:00:00Z" }],
        [{ kickoff: "2026-09-13T00:15:00Z" }],
      ),
      now,
    );
    expect(chosen).toBe("ncaaf");
  });

  it("opens on the next kickoff before anything has started", () => {
    const now = new Date("2026-09-13T14:00:00Z");
    const chosen = sportInPlay(
      slates(
        [{ kickoff: "2026-09-13T23:00:00Z" }],
        [{ kickoff: "2026-09-13T17:00:00Z" }],
      ),
      now,
    );
    expect(chosen).toBe("nfl");
  });

  it("keeps a Saturday night game on Saturday rather than calling it Sunday", () => {
    // 01:00 UTC Sunday: a college game kicked off at 8pm Eastern Saturday.
    const now = new Date("2026-09-13T01:00:00Z");
    const chosen = sportInPlay(
      slates(
        [{ kickoff: "2026-09-13T00:00:00Z" }],
        [{ kickoff: "2026-09-13T17:00:00Z" }],
      ),
      now,
    );
    expect(chosen).toBe("ncaaf");
  });

  it("ignores a game that has already finished", () => {
    const now = new Date("2026-09-12T23:00:00Z");
    const chosen = sportInPlay(
      slates([{ kickoff: "2026-09-12T16:00:00Z", status: "final" }], []),
      now,
    );
    expect(chosen).toBe(null);
  });

  it("says nothing on a day with no football", () => {
    const now = new Date("2026-09-16T18:00:00Z");
    expect(sportInPlay(slates([{ kickoff: "2026-09-12T16:00:00Z" }], []), now)).toBe(null);
  });
});
