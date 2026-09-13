/**
 * Reading scores off a public scoreboard page.
 *
 * The odds feed charges for scores and they are the bulk of what a season
 * spends. A scoreboard page is free, but its markup is nobody's contract, so
 * this does not depend on it: the page is reduced to text and searched for the
 * games we already have.
 *
 * Working from the games we know is what makes this tractable. We are not
 * asking "what is on this page"; we are asking "does this page say anything
 * about Indiana against Howard", which is a much smaller question.
 *
 * A game is only read when the window of text holding both team names also
 * holds exactly two plausible scores. Anything less is left alone: no score is
 * far better than a wrong one, which would mis-grade everybody's picks.
 *
 * Kept free of server imports so the matching can be tested directly.
 */

export type KnownGame = {
  id: string;
  homeTeam: string;
  awayTeam: string;
};

export type ScrapedScore = {
  gameId: string;
  home: number;
  away: number;
  /** True only when the page actually says the game is over. */
  final: boolean;
};

export type ScrapeResult = {
  found: ScrapedScore[];
  /** Games the page said nothing usable about, named so it can be checked. */
  missed: string[];
};

/** Characters that are not a name or a number carry no meaning here. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    // The colon survives so a kickoff time stays one token, "7:30", and can
    // never be mistaken for a score of 7.
    .replace(/[^a-z0-9:\s]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Turns a page into one lowercase line per row, tags and scripts gone. */
export function pageToLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // The page's own line breaks mean nothing -- a row is often written across
    // several source lines -- so only a closing tag starts a new row.
    .replace(/[\r\n\t]+/g, " ")
    // Cells are not rows: a score sits in its own <td> beside its team's, and
    // breaking on </td> would put them on different lines.
    .replace(/<\/(tr|li|p|h[1-6]|div|section|article)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/gi, "&")
    .split(/\n+/)
    .map((line) => normalize(line).trim())
    .filter((line) => line.length > 0);
}

/**
 * The words worth searching for in a team name: the school or city and the
 * mascot, minus the short words that match everything.
 */
function keywords(team: string): string[] {
  return normalize(team)
    .split(" ")
    .filter((word) => word.length >= 3);
}

/** Does this line name the team? Its last word -- the mascot -- must appear. */
function mentions(line: string, team: string): boolean {
  const words = keywords(team);
  if (words.length === 0) return false;
  const needle = words[words.length - 1];
  return new RegExp(`(^| )${needle}( |$)`).test(line);
}

/** How far past a team's name its score may sit before it is somebody else's. */
const SCORE_WITHIN_WORDS = 4;

/**
 * The score a row gives a team: the first plausible number after its name.
 *
 * Reading forward from the name rather than collecting every number in the row
 * is what survives a scoreboard's furniture. "#3 Howard Bison 7" has two
 * numbers in it and only one of them is a score, and the one that counts is
 * the one after the name.
 */
function scoreAfter(words: string[], from: number, stopAt: number): number | null {
  const limit = Math.min(
    words.length,
    from + SCORE_WITHIN_WORDS + 1,
    // Never read past the other team's name: the number beyond it is theirs.
    stopAt > from ? stopAt : words.length,
  );
  for (let at = from + 1; at < limit; at += 1) {
    if (!/^\d{1,3}$/.test(words[at])) continue;
    const value = Number(words[at]);
    return value <= 99 ? value : null;
  }
  return null;
}

/** Where a team is named in a row, by its last keyword: the mascot. */
function positionOf(words: string[], team: string): number {
  const needles = keywords(team);
  if (needles.length === 0) return -1;
  return words.indexOf(needles[needles.length - 1]);
}

/**
 * Finds what the page says about each game.
 *
 * @param window How many consecutive lines may be joined to make one row. A
 *   scoreboard often splits a game across a few elements, so a small window
 *   catches those without letting two different games run together.
 */
export function scoresFromPage(
  html: string,
  games: KnownGame[],
  window = 3,
): ScrapeResult {
  const lines = pageToLines(html);
  const found: ScrapedScore[] = [];
  const missed: string[] = [];

  for (const game of games) {
    let score: ScrapedScore | null = null;

    for (let start = 0; start < lines.length && score === null; start += 1) {
      for (let size = 1; size <= window && start + size <= lines.length; size += 1) {
        const chunk = lines.slice(start, start + size).join(" ");
        if (!mentions(chunk, game.homeTeam) || !mentions(chunk, game.awayTeam)) continue;

        const words = chunk.split(" ");
        const homeAt = positionOf(words, game.homeTeam);
        const awayAt = positionOf(words, game.awayTeam);
        if (homeAt < 0 || awayAt < 0) continue;

        const home = scoreAfter(words, homeAt, awayAt);
        const away = scoreAfter(words, awayAt, homeAt);
        if (home === null || away === null) continue;

        score = {
          gameId: game.id,
          home,
          away,
          final: /\bfinal\b|\bended\b/.test(chunk),
        };
        break;
      }
    }

    if (score) found.push(score);
    else missed.push(`${game.awayTeam} at ${game.homeTeam}`);
  }

  return { found, missed };
}
