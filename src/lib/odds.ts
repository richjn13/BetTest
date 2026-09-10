import "server-only";
import { db, unwrap } from "./db";
import { env } from "./env";
import { weekForKickoff } from "./nfl-week";
import {
  extractHomeSpread,
  extractScores,
  type OddsEvent,
  type ScoreEvent,
} from "./odds-parse";
import { ENDPOINTS, oddsApiUrl, readableError, type Endpoint } from "./odds-url";
import { ensureWeek } from "./queries";

const REQUEST_TIMEOUT_MS = 10_000;

export type SyncResult = {
  ok: boolean;
  /** Games already present with no event id, now linked to the feed. */
  gamesAdopted?: number;
  /** Why the run degraded, if it did. The last known spread stays on screen. */
  error?: string;
  gamesSeen: number;
  gamesInserted: number;
  spreadsUpdated: number;
  scoresUpdated: number;
};

// ------------------------------------------------------------------ fetch

/** An Odds API failure, carrying the status so callers can react to it. */
export class OddsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OddsApiError";
  }
}

/** The quota counters The Odds API returns on every response. */
export type Quota = { remaining: number | null; used: number | null };

function readQuota(response: Response): Quota {
  const toNumber = (value: string | null) => {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    remaining: toNumber(response.headers.get("x-requests-remaining")),
    used: toNumber(response.headers.get("x-requests-used")),
  };
}

let lastQuota: Quota = { remaining: null, used: null };

/** Quota counters from the most recent call this process made. */
export function lastKnownQuota(): Quota {
  return lastQuota;
}

async function getJson<T>(path: Endpoint, params: Record<string, string> = {}): Promise<T> {
  const url = oddsApiUrl(path, env.oddsApiKey, params);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  lastQuota = readQuota(response);

  if (!response.ok) {
    const body = readableError(await response.text().catch(() => ""));
    throw new OddsApiError(
      `The Odds API returned ${response.status}${body ? `: ${body}` : ""}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/**
 * Checks the key without spending quota. The /sports endpoint is free, so this
 * can be called from a diagnostics page as often as you like.
 */
export async function probeOddsFeed(): Promise<{
  ok: boolean;
  status: number | null;
  message: string;
  quota: Quota;
}> {
  if (!process.env.ODDS_API_KEY) {
    return {
      ok: false,
      status: null,
      message: "No key set. The odds feed is off until you add one.",
      quota: { remaining: null, used: null },
    };
  }

  try {
    await getJson<unknown[]>(ENDPOINTS.sports);
    const quota = lastKnownQuota();
    return {
      ok: true,
      status: 200,
      message:
        quota.remaining === null
          ? "The key works."
          : `The key works. ${quota.remaining} of your monthly calls remain.`,
      quota,
    };
  } catch (error) {
    const status = error instanceof OddsApiError ? error.status : null;
    return {
      ok: false,
      status,
      message:
        status === 401
          ? "The key was rejected. Check for a typo, and that you redeployed after setting it."
          : describe(error),
      quota: lastKnownQuota(),
    };
  }
}

// ------------------------------------------------------------------- sync

/**
 * Pulls the current NFL slate and spreads, creating any game we have not seen
 * and refreshing the line on every game that has not yet frozen at kickoff.
 *
 * A failed fetch is reported, not thrown: the stored spreads stay exactly as
 * they were, so members keep seeing the last known line instead of an error.
 */
export async function refreshOdds(): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    gamesSeen: 0,
    gamesInserted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
  };

  let events: OddsEvent[];
  try {
    events = await getJson<OddsEvent[]>(ENDPOINTS.odds, {
      regions: "us",
      markets: "spreads",
      oddsFormat: "american",
      dateFormat: "iso",
    });
  } catch (error) {
    return { ...result, ok: false, error: describe(error) };
  }

  const preferred = env.oddsApiBookmakers;
  const now = new Date().toISOString();

  type GameRow = {
    id: string;
    week_id: string;
    home_team: string;
    away_team: string;
    odds_api_event_id: string | null;
    spread_frozen_at: string | null;
    spread_locked_at: string | null;
  };

  // One read up front instead of several per game. A sixteen game slate was
  // making close to a hundred sequential round trips, which alone can outlast
  // a serverless function's time limit.
  const horizon = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const known =
    unwrap<GameRow[]>(
      await db()
        .from("games")
        .select(
          "id, week_id, home_team, away_team, odds_api_event_id, spread_frozen_at, spread_locked_at",
        )
        .gte("kickoff_time", horizon),
    ) ?? [];

  const byEvent = new Map<string, GameRow>();
  const byMatchup = new Map<string, GameRow>();
  for (const game of known) {
    if (game.odds_api_event_id) byEvent.set(game.odds_api_event_id, game);
    byMatchup.set(`${game.week_id}|${game.away_team}|${game.home_team}`, game);
  }

  // Weeks repeat across every game of a slate, so resolve each one once.
  const weekCache = new Map<string, string>();
  const weekIdFor = async (kickoff: Date): Promise<string> => {
    const { seasonYear, weekNumber } = weekForKickoff(kickoff);
    const key = `${seasonYear}-${weekNumber}`;
    const cached = weekCache.get(key);
    if (cached) return cached;
    const week = await ensureWeek(seasonYear, weekNumber);
    weekCache.set(key, week.id);
    return week.id;
  };

  for (const event of events) {
    result.gamesSeen += 1;
    const kickoff = new Date(event.commence_time);
    if (Number.isNaN(kickoff.getTime())) continue;

    const line = extractHomeSpread(event, preferred);
    let existing = byEvent.get(event.id) ?? null;

    if (!existing) {
      const weekId = await weekIdFor(kickoff);

      // The game may already be here without an event id, put there by a
      // Claude pull or entered by hand. Adopt it: inserting a second copy
      // would double the slate, and a game with no event id can never be
      // matched by the scores feed, so its picks would never grade.
      const orphan = byMatchup.get(`${weekId}|${event.away_team}|${event.home_team}`);

      if (orphan && !orphan.odds_api_event_id) {
        const link = await db()
          .from("games")
          .update({ odds_api_event_id: event.id })
          .eq("id", orphan.id)
          .is("odds_api_event_id", null)
          .select("id");
        if (!link.error) {
          result.gamesAdopted = (result.gamesAdopted ?? 0) + 1;
          orphan.odds_api_event_id = event.id;
          existing = orphan;
        }
      }

      if (!existing) {
        const insert = await db()
          .from("games")
          .insert({
            week_id: weekId,
            home_team: event.home_team,
            away_team: event.away_team,
            kickoff_time: kickoff.toISOString(),
            home_spread: line?.spread ?? null,
            spread_source: line?.source ?? null,
            spread_updated_at: line ? now : null,
            odds_api_event_id: event.id,
          })
          .select("id");
        // A duplicate means a concurrent run inserted it first; nothing to do.
        if (!insert.error) result.gamesInserted += 1;
        continue;
      }
    }

    // Frozen at kickoff, or locked by a deliberate pull: leave it alone.
    if (existing.spread_frozen_at || existing.spread_locked_at || !line) continue;

    const update = await db()
      .from("games")
      .update({
        home_spread: line.spread,
        spread_source: line.source,
        spread_updated_at: now,
        kickoff_time: kickoff.toISOString(),
      })
      .eq("id", existing.id)
      .is("spread_frozen_at", null)
      .is("spread_locked_at", null)
      .select("id");
    if (!update.error) result.spreadsUpdated += 1;
  }

  return result;
}

/**
 * Pulls final scores. Games an admin corrected by hand are left alone so a
 * lagging feed cannot overwrite the correction.
 */
export async function refreshScores(daysFrom = 3): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    gamesSeen: 0,
    gamesInserted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
  };

  // daysFrom asks for games that already finished, which The Odds API treats as
  // historical data and restricts to paid plans. On a free plan that request is
  // rejected, so fall back to the unparameterized call, which still returns
  // games in progress and those that finished very recently.
  let events: ScoreEvent[];
  try {
    events = await getJson<ScoreEvent[]>(ENDPOINTS.scores, {
      daysFrom: String(daysFrom),
      dateFormat: "iso",
    });
  } catch (first) {
    try {
      events = await getJson<ScoreEvent[]>(ENDPOINTS.scores, { dateFormat: "iso" });
    } catch {
      // Report the original failure: it describes the request we wanted.
      return { ...result, ok: false, error: describe(first) };
    }
  }

  for (const event of events) {
    result.gamesSeen += 1;
    const parsed = extractScores(event);
    if (!parsed) continue;

    const update = await db()
      .from("games")
      .update({
        final_home_score: parsed.home,
        final_away_score: parsed.away,
        status: event.completed ? "final" : "live",
      })
      .eq("odds_api_event_id", event.id)
      .is("score_overridden_at", null)
      .select("id");
    if (!update.error && update.data && update.data.length > 0) result.scoresUpdated += 1;
  }

  return result;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
