/**
 * Parsing of The Odds API payloads. Kept separate from the fetching and
 * database work in odds.ts so the shape handling can be tested directly.
 */

export type OddsEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: {
    key: string;
    title?: string;
    markets?: { key: string; outcomes?: { name: string; point?: number }[] }[];
  }[];
};

export type ScoreEvent = {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores?: { name: string; score: string }[] | null;
};

/**
 * The home team's spread from the most preferred bookmaker that has posted
 * one. Returns null when no book has a spread yet, which is normal for games
 * far out and for a feed that returned an event with no odds attached.
 */
export function extractHomeSpread(
  event: OddsEvent,
  preferred: string[],
): { spread: number; source: string } | null {
  const books = event.bookmakers ?? [];
  const ordered = [
    ...preferred.flatMap((key) => books.filter((book) => book.key === key)),
    ...books.filter((book) => !preferred.includes(book.key)),
  ];

  for (const book of ordered) {
    const market = book.markets?.find((candidate) => candidate.key === "spreads");
    const outcome = market?.outcomes?.find((candidate) => candidate.name === event.home_team);
    if (outcome && typeof outcome.point === "number") {
      return { spread: outcome.point, source: book.key };
    }
  }
  return null;
}

/** Final scores for one event, or null while the feed has nothing usable. */
export function extractScores(
  event: ScoreEvent,
): { home: number; away: number } | null {
  const scores = event.scores ?? [];
  const home = toNumber(scores.find((entry) => entry.name === event.home_team)?.score);
  const away = toNumber(scores.find((entry) => entry.name === event.away_team)?.score);
  if (home === null || away === null) return null;
  return { home, away };
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The over/under from the most preferred bookmaker that has posted one. Totals
 * come back as two outcomes, Over and Under, carrying the same number, so
 * either one answers the question.
 */
export function extractTotal(
  event: OddsEvent,
  preferred: string[],
): { total: number; source: string } | null {
  const books = event.bookmakers ?? [];
  const ordered = [
    ...preferred.flatMap((key) => books.filter((book) => book.key === key)),
    ...books.filter((book) => !preferred.includes(book.key)),
  ];

  for (const book of ordered) {
    const market = book.markets?.find((candidate) => candidate.key === "totals");
    const outcome = market?.outcomes?.find(
      (candidate) => typeof candidate.point === "number",
    );
    if (outcome && typeof outcome.point === "number" && outcome.point > 0) {
      return { total: outcome.point, source: book.key };
    }
  }
  return null;
}

/** A game the feed offered, before we decide whether it makes the slate. */
export type Candidate = {
  awayTeam: string;
  homeTeam: string;
  kickoffIso: string;
  homeSpread: number;
  homeRank: number | null;
  awayRank: number | null;
};

/**
 * Cuts a long slate down to the games worth offering.
 *
 * College football plays well over fifty games a Saturday, which is far too
 * many to pick from. Ranked teams come first, best ranking first, and after
 * them the closest lines, on the reasoning that a pick'em is only interesting
 * where the outcome is in doubt.
 */
export function selectGames(candidates: Candidate[], limit: number): Candidate[] {
  const best = (game: Candidate) =>
    Math.min(game.homeRank ?? 99, game.awayRank ?? 99);

  return [...candidates]
    .sort((a, b) => {
      const rank = best(a) - best(b);
      if (rank !== 0) return rank;
      const closeness = Math.abs(a.homeSpread) - Math.abs(b.homeSpread);
      if (closeness !== 0) return closeness;
      return a.kickoffIso.localeCompare(b.kickoffIso);
    })
    .slice(0, limit);
}
