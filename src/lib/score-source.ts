import "server-only";
import {
  scoresFromJson,
  scoresFromPage,
  type KnownGame,
  type ScrapeResult,
} from "./score-scrape";
import type { Sport } from "./sports";

/**
 * Scores from a public scoreboard page, for nothing.
 *
 * The odds feed charges for scores and they are almost all of what a season
 * spends; the lines themselves are four calls a week. A page costs nothing and
 * has no monthly allowance, so with one configured the feed becomes a fallback
 * rather than the mechanism.
 *
 * With nothing configured it reads a public scoreboard API, which answers
 * with JSON: both teams and both numbers in named fields, nothing to parse out
 * of markup that changes. That is the difference between this working and not.
 * A scoreboard *page* -- ncaa.com, nfl.com -- draws itself in the browser and
 * its HTML carries no scores at all, so pointing this at one reads nothing.
 *
 * Override with any of these, in Vercel's environment variables:
 *
 *   NFL_SCORES_URL     a scoreboard for the NFL
 *   NCAAF_SCORES_URL   a scoreboard for college
 *   SCORES_URL         one covering both, used when the specific one is unset
 *
 * A URL answering JSON is read as JSON; anything else is read as a page.
 */

/**
 * Where scores come from when nothing is configured: the scoreboard behind
 * ESPN's own site. No key, no monthly allowance, and it is JSON, so nothing
 * here depends on how a page happens to be built today.
 */
const DEFAULT_SCOREBOARD: Record<Sport, string> = {
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  ncaaf:
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=200",
};

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 6_000_000;

export function scoresUrl(sport: Sport): string | null {
  const specific = sport === "ncaaf" ? process.env.NCAAF_SCORES_URL : process.env.NFL_SCORES_URL;
  return specific?.trim() || process.env.SCORES_URL?.trim() || DEFAULT_SCOREBOARD[sport];
}

export type PageScores = ScrapeResult & { url: string | null; error: string | null };

export async function scoresFromWeb(
  sport: Sport,
  games: KnownGame[],
): Promise<PageScores> {
  const configured = scoresUrl(sport);
  const fallback = DEFAULT_SCOREBOARD[sport];
  const first = await readScoreboard(configured, games);

  // A configured page that yields nothing is the common way this ends up
  // broken -- a scoreboard that draws itself in the browser looks fine in a
  // browser and is empty to us. Rather than leave a week unscored over an
  // environment variable, fall back to the scoreboard that answers JSON.
  if (first.found.length > 0 || configured === fallback) return first;

  const second = await readScoreboard(fallback, games);
  if (second.found.length === 0) return first;
  return second;
}

async function readScoreboard(
  url: string | null,
  games: KnownGame[],
): Promise<PageScores> {
  const empty: PageScores = { found: [], missed: [], url, error: null };

  if (!url) return { ...empty, error: "No scoreboard is configured for this competition." };
  if (games.length === 0) return empty;

  let html: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PickemBot/1.0)",
        accept: "application/json,text/html;q=0.9",
      },
    });
    if (!response.ok) return { ...empty, error: `${url} answered ${response.status}.` };
    const body = await response.text();

    // JSON is the good case and needs no truncation guard beyond the read
    // itself: it is parsed whole or not at all.
    const looksJson =
      (response.headers.get("content-type") ?? "").includes("json") ||
      body.trimStart().startsWith("{");
    if (looksJson) {
      try {
        return { ...scoresFromJson(JSON.parse(body), games), url, error: null };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ...empty, error: `${url} answered JSON that could not be read: ${reason}` };
      }
    }

    html = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...empty, error: `Could not reach ${url}: ${reason}` };
  }

  return { ...scoresFromPage(html, games), url, error: null };
}
