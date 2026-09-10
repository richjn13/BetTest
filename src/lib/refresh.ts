import "server-only";
import { freezeKickedOffSpreads, gradeResolvedGames } from "./grading";
import { refreshOdds, refreshScores } from "./odds";

export type RefreshResult = {
  ok: boolean;
  /** Odds feed problems. These degrade the run without changing stored data. */
  degraded: string[];
  /** The spreads pull specifically. Null means it worked. */
  oddsError: string | null;
  /** The scores pull specifically. Null means it worked. */
  scoresError: string | null;
  /** A database failure, which is a real outage rather than a soft degrade. */
  databaseError: string | null;
  frozen: number | null;
  gamesInserted: number;
  /** Games already present with no event id, now linked to the feed. */
  gamesAdopted: number;
  spreadsUpdated: number;
  scoresUpdated: number;
  graded: number | null;
};

/**
 * The full maintenance pass, shared by the cron endpoint and the admin panel's
 * refresh button so the two can never drift apart.
 *
 * Order matters, and freezing has to come first. Freezing stamps the line on
 * every game whose kickoff has passed; the odds refresh then skips those games
 * because they are frozen. Refreshing first would let a stale or revised line
 * overwrite the number a pick should be graded against, in the window between
 * kickoff and the next run. On a 15-minute schedule that window is minutes
 * wide. On a weekly schedule it is a week wide.
 */
export async function runRefresh(): Promise<RefreshResult> {
  const result: RefreshResult = {
    ok: true,
    degraded: [],
    oddsError: null,
    scoresError: null,
    databaseError: null,
    frozen: null,
    gamesInserted: 0,
    gamesAdopted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
    graded: null,
  };

  // 1. Freeze anything past kickoff, before any new line can land on it.
  try {
    result.frozen = await freezeKickedOffSpreads();
  } catch (error) {
    result.databaseError = describe(error);
    console.error("refresh: freezing lines failed", error);
    return { ...result, ok: false };
  }

  // 2. Pull current spreads and any newly scheduled games.
  const odds = await refreshOdds();
  result.gamesInserted = odds.gamesInserted;
  result.gamesAdopted = odds.gamesAdopted ?? 0;
  result.spreadsUpdated = odds.spreadsUpdated;
  if (odds.error) {
    result.oddsError = odds.error;
    result.degraded.push(odds.error);
  }

  // 3. Pull scores for games in progress or recently finished.
  const scores = await refreshScores();
  result.scoresUpdated = scores.scoresUpdated;
  if (scores.error) {
    result.scoresError = scores.error;
    result.degraded.push(scores.error);
  }

  // 4. Regrade every pick on a resolved game.
  try {
    result.graded = await gradeResolvedGames();
  } catch (error) {
    result.databaseError = describe(error);
    console.error("refresh: grading failed", error);
  }

  result.ok = result.degraded.length === 0 && result.databaseError === null;
  return result;
}

/** A one-line summary for the admin panel. */
export function summarize(result: RefreshResult): string {
  return (
    `${result.gamesInserted} new games, ` +
    (result.gamesAdopted > 0 ? `${result.gamesAdopted} linked to the feed, ` : "") +
    `${result.spreadsUpdated} spreads, ` +
    `${result.scoresUpdated} scores, ${result.frozen ?? 0} lines frozen, ` +
    `${result.graded ?? 0} picks graded.`
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
