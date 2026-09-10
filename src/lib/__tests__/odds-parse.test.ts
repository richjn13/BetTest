import { describe, expect, it } from "vitest";
import { extractHomeSpread, extractScores, type OddsEvent } from "../odds-parse";

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
