import "server-only";
import { db, unwrap } from "./db";
import { freezeKickedOffSpreads, gradeResolvedGames } from "./grading";
import { refreshOdds, refreshScores } from "./odds";
import { listOpenedWeeks } from "./queries";

export type RefreshResult = {
  ok: boolean;
  /** Odds feed problems. These degrade the run without changing stored data. */
  degraded: string[];
  /** The spreads pull specifically. Null means it worked. */
  oddsError: string | null;
  /** The scores pull specifically. Null means it worked. */
  scoresError: string | null;
  /** True when the run found nothing to fetch and spent no API call. */
  skipped: boolean;
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
export type RefreshMode = "full" | "scores";

export async function runRefresh(mode: RefreshMode = "full"): Promise<RefreshResult> {
  const result: RefreshResult = {
    ok: true,
    degraded: [],
    oddsError: null,
    scoresError: null,
    skipped: false,
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

  // 2. Pull current spreads and any newly scheduled games. Skipped in scores
  // mode, which exists so a frequent schedule costs one API call instead of
  // two -- spreads barely move once a week is pulled and locked, but scores
  // change every few minutes while games are on.
  if (mode === "full") {
    const odds = await refreshOdds();
    result.gamesInserted = odds.gamesInserted;
    result.gamesAdopted = odds.gamesAdopted ?? 0;
    result.spreadsUpdated = odds.spreadsUpdated;
    if (odds.error) {
      result.oddsError = odds.error;
      result.degraded.push(odds.error);
    }
  }

  // 3. Pull scores, but only if any game is actually waiting on one. A
  // scheduled run outside game time, or after every game has gone final,
  // otherwise spends an API call to be told nothing changed. Checking the
  // database first is free; the call is not.
  let pending = true;
  try {
    pending = await hasPendingScores();
  } catch (error) {
    // If the check fails, fetch rather than silently skip.
    console.error("refresh: could not check for pending scores", error);
  }

  if (pending) {
    const scores = await refreshScores();
    result.scoresUpdated = scores.scoresUpdated;
    if (scores.error) {
      result.scoresError = scores.error;
      result.degraded.push(scores.error);
    }
  } else {
    result.skipped = true;
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

/** How long a game may sit unresolved before we stop asking about it. */
const STALE_GAME_DAYS = 7;

/**
 * Is any game waiting on a score? True when a game in an open week has kicked
 * off, is not yet final, and is recent enough to still be worth asking about.
 *
 * A game stuck unresolved for longer than a week is an admin problem, not a
 * feed problem, and should not keep spending API calls forever.
 */
export async function hasPendingScores(now: Date = new Date()): Promise<boolean> {
  const live = (await listOpenedWeeks())
    .filter((week) => week.closed_at === null)
    .map((week) => week.id);
  if (live.length === 0) return false;

  const rows =
    unwrap<{ id: string }[]>(
      await db()
        .from("games")
        .select("id")
        .in("week_id", live)
        .neq("status", "final")
        .neq("status", "postponed")
        .neq("status", "canceled")
        .lte("kickoff_time", now.toISOString())
        .gte(
          "kickoff_time",
          new Date(now.getTime() - STALE_GAME_DAYS * 86_400_000).toISOString(),
        )
        .limit(1),
    ) ?? [];

  return rows.length > 0;
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
