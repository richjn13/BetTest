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
