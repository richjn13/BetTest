import "server-only";
import { scoresFromPage, type KnownGame, type ScrapeResult } from "./score-scrape";
import type { Sport } from "./sports";

/**
 * Scores from a public scoreboard page, for nothing.
 *
 * The odds feed charges for scores and they are almost all of what a season
 * spends; the lines themselves are four calls a week. A page costs nothing and
 * has no monthly allowance, so with one configured the feed becomes a fallback
 * rather than the mechanism.
 *
 * Configure with any of these, in Vercel's environment variables:
 *
 *   NFL_SCORES_URL     a page listing NFL scores
 *   NCAAF_SCORES_URL   a page listing college scores
 *   SCORES_URL         one page covering both, used when the specific one is unset
 *
 * None set means nothing changes and the feed is used as before.
 */

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 6_000_000;

export function scoresUrl(sport: Sport): string | null {
  const specific = sport === "ncaaf" ? process.env.NCAAF_SCORES_URL : process.env.NFL_SCORES_URL;
  return specific?.trim() || process.env.SCORES_URL?.trim() || null;
}

export type PageScores = ScrapeResult & { url: string | null; error: string | null };

export async function scoresFromWeb(
  sport: Sport,
  games: KnownGame[],
): Promise<PageScores> {
  const url = scoresUrl(sport);
  const empty: PageScores = { found: [], missed: [], url, error: null };

  if (!url) return { ...empty, error: "No scores page is configured for this competition." };
  if (games.length === 0) return empty;

  let html: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PickemBot/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return { ...empty, error: `${url} answered ${response.status}.` };
    const body = await response.text();
    html = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...empty, error: `Could not reach ${url}: ${reason}` };
  }

  return { ...scoresFromPage(html, games), url, error: null };
}
