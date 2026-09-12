import { describe, expect, it } from "vitest";
import {
  extractHomeSpread,
  extractScores,
  extractTotal,
  selectGames,
  type OddsEvent,
} from "../odds-parse";

const event = (bookmakers: OddsEvent["bookmakers"]): OddsEvent => ({
  id: "evt",
  commence_time: "2025-09-07T17:00:00Z",
  home_team: "Kansas City Chiefs",
  away_team: "Buffalo Bills",
  bookmakers,
});

const spreadsBook = (key: string, homePoint: number) => ({
  key,
  markets: [
    {
      key: "spreads",
      outcomes: [
        { name: "Kansas City Chiefs", point: homePoint },
        { name: "Buffalo Bills", point: -homePoint },
      ],
    },
  ],
});

describe("extractHomeSpread", () => {
  it("reads the spread from the home team's outcome", () => {
    expect(extractHomeSpread(event([spreadsBook("draftkings", -3.5)]), [])).toEqual({
      spread: -3.5,
      source: "draftkings",
    });
  });

  it("prefers the first configured bookmaker regardless of feed order", () => {
    const events = event([spreadsBook("betmgm", -7), spreadsBook("fanduel", -3)]);
    expect(extractHomeSpread(events, ["fanduel", "betmgm"])?.source).toBe("fanduel");
  });

  it("falls back to any other book when no preferred book has a line", () => {
    const events = event([spreadsBook("betmgm", -7)]);
    expect(extractHomeSpread(events, ["fanduel"])).toEqual({ spread: -7, source: "betmgm" });
  });

  it("returns null when no book has posted a spread", () => {
    expect(extractHomeSpread(event([]), ["fanduel"])).toBeNull();
    expect(extractHomeSpread(event(undefined), [])).toBeNull();
    expect(
      extractHomeSpread(event([{ key: "fanduel", markets: [{ key: "h2h", outcomes: [] }] }]), []),
    ).toBeNull();
  });

  it("skips a book whose spreads market is missing the home team", () => {
    const partial = event([
      { key: "betmgm", markets: [{ key: "spreads", outcomes: [{ name: "Buffalo Bills", point: 3 }] }] },
      spreadsBook("fanduel", -3),
    ]);
    expect(extractHomeSpread(partial, [])?.source).toBe("fanduel");
  });

  it("keeps a pick'em line of zero rather than treating it as missing", () => {
    expect(extractHomeSpread(event([spreadsBook("fanduel", 0)]), [])?.spread).toBe(0);
  });
});

describe("extractScores", () => {
  const base = {
    id: "evt",
    commence_time: "2025-09-07T17:00:00Z",
    completed: true,
    home_team: "Kansas City Chiefs",
    away_team: "Buffalo Bills",
  };

  it("parses the string scores the feed returns", () => {
    expect(
      extractScores({
        ...base,
        scores: [
          { name: "Kansas City Chiefs", score: "24" },
          { name: "Buffalo Bills", score: "17" },
        ],
      }),
    ).toEqual({ home: 24, away: 17 });
  });

  it("returns null when either side is missing", () => {
    expect(extractScores({ ...base, scores: null })).toBeNull();
    expect(
      extractScores({ ...base, scores: [{ name: "Kansas City Chiefs", score: "24" }] }),
    ).toBeNull();
  });
});

describe("extractTotal", () => {
  const event = (books: unknown) =>
    ({
      id: "1",
      commence_time: "2026-09-13T17:00:00Z",
      home_team: "Kansas City Chiefs",
      away_team: "Buffalo Bills",
      bookmakers: books,
    }) as never;

  const totalsBook = (key: string, point: number) => ({
    key,
    markets: [
      {
        key: "totals",
        outcomes: [
          { name: "Over", point },
          { name: "Under", point },
        ],
      },
    ],
  });

  it("reads the number off either outcome", () => {
    expect(extractTotal(event([totalsBook("draftkings", 47.5)]), [])).toEqual({
      total: 47.5,
      source: "draftkings",
    });
  });

  it("prefers the named bookmaker", () => {
    const found = extractTotal(
      event([totalsBook("fanduel", 44), totalsBook("draftkings", 47.5)]),
      ["draftkings"],
    );
    expect(found).toEqual({ total: 47.5, source: "draftkings" });
  });

  it("returns null when no book has posted a total", () => {
    expect(extractTotal(event([{ key: "draftkings", markets: [] }]), [])).toBe(null);
    expect(extractTotal(event(undefined), [])).toBe(null);
  });
});

describe("selectGames", () => {
  const game = (
    name: string,
    spread: number,
    homeRank: number | null = null,
    hour = 17,
  ) => ({
    awayTeam: `${name} away`,
    homeTeam: name,
    kickoffIso: `2026-09-12T${String(hour).padStart(2, "0")}:00:00Z`,
    homeSpread: spread,
    homeRank,
    awayRank: null,
  });

  const names = (chosen: { homeTeam: string }[]) => chosen.map((entry) => entry.homeTeam);

  it("mixes ranked games with close ones instead of taking all the ranked", () => {
    const pool = [
      game("blowout-1", -38, 1),
      game("blowout-2", -35, 2),
      game("blowout-3", -31, 3),
      game("tight-1", 1),
      game("tight-2", -2.5),
      game("tight-3", 3),
    ];
    const chosen = names(selectGames(pool, 4));

    // Two from each ordering, rather than the four best rankings.
    expect(chosen.filter((name) => name.startsWith("blowout"))).toHaveLength(2);
    expect(chosen.filter((name) => name.startsWith("tight"))).toHaveLength(2);
    expect(chosen).toContain("blowout-1");
    expect(chosen).toContain("tight-1");
  });

  it("returns the pool in kickoff order", () => {
    const chosen = selectGames(
      [game("late", -3, null, 23), game("early", -14, 1, 16), game("middle", -7, null, 20)],
      3,
    );
    expect(names(chosen)).toEqual(["early", "middle", "late"]);
  });

  it("never lists the same game twice, whichever ordering reached it", () => {
    // The closest line also belongs to the best ranked team.
    const pool = [game("both", -1, 1), game("other", -9), game("third", -20)];
    const chosen = names(selectGames(pool, 3));
    expect(new Set(chosen).size).toBe(3);
  });

  it("copes with a pool that has no ranked teams at all", () => {
    const pool = [game("a", -17), game("b", 2.5), game("c", -7)];
    expect(names(selectGames(pool, 2)).sort()).toEqual(["b", "c"]);
  });

  it("cuts the slate to the limit, and stops when the pool runs out", () => {
    const many = Array.from({ length: 60 }, (_, index) => game(String(index), index));
    expect(selectGames(many, 40)).toHaveLength(40);
    expect(selectGames(many.slice(0, 5), 40)).toHaveLength(5);
  });
});
