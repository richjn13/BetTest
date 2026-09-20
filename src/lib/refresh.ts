import "server-only";
import { db, unwrap } from "./db";
import { freezeKickedOffSpreads, gradeResolvedGames } from "./grading";
import { refreshOdds, refreshScores } from "./odds";
import { scoresFromWeb, scoresUrl } from "./score-source";
import { applyScrapedScores, getGamesForWeek, listOpenedWeeks } from "./queries";
import type { Sport } from "./sports";

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
  /** Scores read off a configured scoreboard page, which cost nothing. */
  fromPage?: number;
  /** What the scoreboard page did, whether or not it wrote anything. */
  page: {
    /** The host of the configured page, or null when none is set. */
    host: string | null;
    /** Games the page yielded a score for, written or not. */
    found: number;
    /** Games it said nothing usable about, a few of them named. */
    missed: string[];
  };
  /** The open week the run was fetching for, if any. */
  waitingOn: string | null;
  /** A database failure, which is a real outage rather than a soft degrade. */
  databaseError: string | null;
  frozen: number | null;
  gamesInserted: number;
  /** Games already present with no event id, now linked to the feed. */
  gamesAdopted: number;
  spreadsUpdated: number;
  scoresUpdated: number;
  /** How many games the scores feed answered with, matched or not. */
  eventsReturned: number | null;
  /** Our games past kickoff that neither the page nor the feed mentioned. */
  unmatched: string[];
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
/**
 * What a run is for. There used to be a "full" mode that did both at once,
 * reached only by a scheduled endpoint that no scheduler called; spreads and
 * scores are wanted at different moments and by different buttons, so they are
 * two modes and nothing asks for both.
 */
export type RefreshMode = "scores" | "odds";

/**
 * @param weekId Restricts the run to one week, for a button that says which
 *   week it is pulling. A targeted run also skips the "is anything actually
 *   waiting on a score" shortcut: somebody pressed the button on purpose, and
 *   the usual reason is a game the shortcut decided was not worth asking about.
 */
export async function runRefresh(
  mode: RefreshMode,
  sport: Sport = "nfl",
  weekId: string | null = null,
): Promise<RefreshResult> {
  const result: RefreshResult = {
    ok: true,
    degraded: [],
    oddsError: null,
    scoresError: null,
    skipped: false,
    waitingOn: null,
    databaseError: null,
    frozen: null,
    gamesInserted: 0,
    gamesAdopted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
    eventsReturned: null,
    unmatched: [],
    page: { host: null, found: 0, missed: [] },
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

  // 2. Pull current spreads and any newly scheduled games. Only in odds mode:
  // spreads barely move once a week is pulled and locked, while scores change
  // every few minutes during a game, so a frequent run asks for scores alone.
  if (mode === "odds") {
    const odds = await refreshOdds(sport, weekId ? [weekId] : null);
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
  if (mode === "odds") {
    try {
      result.graded = await gradeResolvedGames();
    } catch (error) {
      result.databaseError = describe(error);
      console.error("refresh: grading failed", error);
    }
    result.ok = result.degraded.length === 0 && result.databaseError === null;
    return result;
  }

  let pending: PendingScores = { count: 1, weekLabel: null, daysBack: 0 };
  try {
    pending = await pendingScores(new Date(), sport);
  } catch (error) {
    // If the check fails, fetch rather than silently skip.
    console.error("refresh: could not check for pending scores", error);
  }
  // Asked for by hand, for one week: make the call regardless.
  if (weekId) pending = { ...pending, count: Math.max(1, pending.count) };

  result.waitingOn = pending.weekLabel;

  // A configured scoreboard page is free and has no monthly allowance, so it
  // is tried first and the feed only picks up what it could not read.
  const configured = scoresUrl(sport);
  if (configured) {
    // The host alone, never the whole URL: it can carry a key in a query
    // string, and this ends up in a log anybody with the repo can read.
    try {
      result.page.host = new URL(configured).host;
    } catch {
      result.page.host = "unreadable URL";
    }
  }

  if (pending.count > 0 && configured) {
    try {
      const live = (await listOpenedWeeks(sport)).filter((entry) => entry.closed_at === null);
      const targets = weekId ? live.filter((entry) => entry.id === weekId) : live;

      for (const target of targets) {
        const games = (await getGamesForWeek(target.id))
          .filter((game) => game.excluded_at === null && game.status !== "final")
          .map((game) => ({
            id: game.id,
            homeTeam: game.home_team,
            awayTeam: game.away_team,
          }));
        if (games.length === 0) continue;

        const page = await scoresFromWeb(sport, games);
        if (page.error) {
          result.degraded.push(page.error);
          continue;
        }
        // A page that loads and yields nothing is the quietest failure here:
        // no error, no scores, and a run that looks like it worked. Counted
        // either way so the two can be told apart from the outside.
        result.page.found += page.found.length;
        result.page.missed.push(...page.missed);
        const written = await applyScrapedScores(target.id, page.found);
        result.scoresUpdated += written.updated;
        result.fromPage = (result.fromPage ?? 0) + written.updated;
      }

      // Everything the page could read is in. Only ask the feed if something
      // is still outstanding -- including for a hand-pressed run, which was
      // forced above precisely because the page might not have been set up.
      pending = await pendingScores(new Date(), sport);
    } catch (error) {
      result.degraded.push(describe(error));
    }
  }

  if (pending.count > 0) {
    // Only reach for the historical window when something is genuinely old
    // enough to need it. The plain request covers live and just-finished, and
    // is the one a free plan allows.
    const scores = await refreshScores(
      pending.daysBack >= 1 ? pending.daysBack + 1 : null,
      sport,
      weekId ? [weekId] : null,
    );
    // Added, not assigned: the page may already have written some, and
    // overwriting the count here reported those as never having happened.
    result.scoresUpdated += scores.scoresUpdated;
    result.eventsReturned = scores.eventsReturned ?? null;
    result.unmatched = scores.unmatched ?? [];
    // Not an error -- the run still worked -- but the reason a finished game
    // can never arrive, which belongs in the run's own report.
    if (scores.historyRefused) result.degraded.push(scores.historyRefused);
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

export type PendingScores = {
  /** Games in an open week that have kicked off and are not yet final. */
  count: number;
  /** The week they belong to, for the run's log. */
  weekLabel: string | null;
  /** How many days back the oldest of them kicked off, rounded up. */
  daysBack: number;
};

/**
 * What the open weeks are waiting on.
 *
 * Everything here is decided from stored data, which is free, so a run that
 * finds nothing spends no API call at all. Closed weeks are excluded outright:
 * their scores are final and nothing should be fetched for them.
 *
 * A game stuck unresolved for longer than a week is an admin problem, not a
 * feed problem, and stops counting so it cannot spend calls forever.
 */
export async function pendingScores(
  now: Date = new Date(),
  sport?: Sport,
  /**
   * How far back a kicked-off game still counts as waiting. The scheduled run
   * uses a week, so a Sunday game that never resolved is still chased on the
   * Tuesday. A page view uses a few hours: a game that kicked off yesterday is
   * not being watched, and letting it count would mean every page view all week
   * spending a call on it.
   */
  maxAgeMs: number = STALE_GAME_DAYS * 86_400_000,
): Promise<PendingScores> {
  const none: PendingScores = { count: 0, weekLabel: null, daysBack: 0 };

  const open = (await listOpenedWeeks(sport)).filter((week) => week.closed_at === null);
  if (open.length === 0) return none;

  const labels = new Map(open.map((week) => [week.id, week.label]));
  const rows =
    unwrap<{ id: string; week_id: string; kickoff_time: string }[]>(
      await db()
        .from("games")
        .select("id, week_id, kickoff_time")
        .in("week_id", [...labels.keys()])
        .neq("status", "final")
        .neq("status", "postponed")
        .neq("status", "canceled")
        .lte("kickoff_time", now.toISOString())
        .gte("kickoff_time", new Date(now.getTime() - maxAgeMs).toISOString())
        .order("kickoff_time"),
    ) ?? [];

  if (rows.length === 0) return none;

  const oldest = new Date(rows[0].kickoff_time).getTime();
  const daysBack = Math.ceil((now.getTime() - oldest) / 86_400_000);

  return {
    count: rows.length,
    weekLabel: labels.get(rows[0].week_id) ?? null,
    daysBack: Math.max(0, daysBack),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
