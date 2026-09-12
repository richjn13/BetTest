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
  homeRecord?: string | null;
  awayRecord?: string | null;
};

/**
 * Cuts a long slate down to the games worth offering.
 *
 * College football plays sixty or more games a week, which is far too many to
 * pick from, but the obvious cut -- ranked teams first -- produces a list of
 * top ten sides beating nobody by forty, which is the least interesting pick
 * sheet imaginable. So two orderings are drawn from in turn: the ranked games,
 * best ranking first, and the closest lines whatever the names. A pool built
 * that way has the marquee games in it and a competitive game between every
 * pair of them.
 */
export function selectGames(candidates: Candidate[], limit: number): Candidate[] {
  const bestRank = (game: Candidate) => Math.min(game.homeRank ?? 99, game.awayRank ?? 99);

  const ranked = candidates
    .filter((game) => bestRank(game) < 99)
    .sort((a, b) => bestRank(a) - bestRank(b) || compareCloseness(a, b));

  const closest = [...candidates].sort(compareCloseness);

  const chosen: Candidate[] = [];
  const taken = new Set<Candidate>();
  const cursor = { ranked: 0, closest: 0 };

  // Turns alternate whether or not a turn produced anything, so a spent list
  // yields to the other one instead of stalling the loop.
  for (let turn = 0; chosen.length < limit; turn += 1) {
    if (cursor.ranked >= ranked.length && cursor.closest >= closest.length) break;

    const key = turn % 2 === 0 ? "ranked" : "closest";
    const source = key === "ranked" ? ranked : closest;

    // Walk past anything the other ordering already claimed.
    while (cursor[key] < source.length && taken.has(source[cursor[key]])) {
      cursor[key] += 1;
    }
    if (cursor[key] >= source.length) continue;

    const game = source[cursor[key]];
    cursor[key] += 1;
    taken.add(game);
    chosen.push(game);
  }

  // Back into kickoff order: a pool is read as a schedule, not as a ranking.
  return chosen.sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));
}

/** Closest line first, and an earlier kickoff breaks a tie. */
function compareCloseness(a: Candidate, b: Candidate): number {
  return (
    Math.abs(a.homeSpread) - Math.abs(b.homeSpread) ||
    a.kickoffIso.localeCompare(b.kickoffIso)
  );
}
