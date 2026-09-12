import "server-only";
import { db, unwrap } from "./db";
import { env } from "./env";
import { isSaturdayGame, weekForSport } from "./season-week";
import {
  extractHomeSpread,
  extractScores,
  extractTotal,
  selectGames,
  type Candidate,
  type OddsEvent,
  type ScoreEvent,
} from "./odds-parse";
import type { PullResult } from "./claude-odds-validate";
import { fetchApTop25 } from "./claude-ranks";
import { rankFor } from "./rankings";
import {
  SPORTS_ENDPOINT,
  oddsApiUrl,
  oddsEndpoint,
  readableError,
  scoresEndpoint,
  type Endpoint,
} from "./odds-url";
import { sportConfig, type Sport } from "./sports";
import { listOpenedWeeks } from "./queries";

const REQUEST_TIMEOUT_MS = 10_000;

export type SyncResult = {
  ok: boolean;
  /** Games already present with no event id, now linked to the feed. */
  gamesAdopted?: number;
  /** Events skipped because their week has not been pulled, or is closed. */
  gamesSkipped?: number;
  /** Games whose kickoff the feed moved, as flex scheduling does. */
  kickoffsMoved?: number;
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
function lastKnownQuota(): Quota {
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
    await getJson<unknown[]>(SPORTS_ENDPOINT);
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
export async function refreshOdds(sport: Sport = "nfl"): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    gamesSeen: 0,
    gamesInserted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
  };

  let events: OddsEvent[];
  try {
    events = await getJson<OddsEvent[]>(oddsEndpoint(sportConfig(sport).oddsApiKey), {
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

  // Only weeks that have been deliberately pulled, and are not yet closed,
  // may receive anything. This is what keeps next week's lines from appearing
  // before you pull them, and what keeps a finished week finished.
  const live = (await listOpenedWeeks(sport)).filter((week) => week.closed_at === null);
  const liveWeekIds = new Map(
    live.map((week) => [`${week.season_year}-${week.week_number}`, week.id]),
  );

  for (const event of events) {
    result.gamesSeen += 1;
    const kickoff = new Date(event.commence_time);
    if (Number.isNaN(kickoff.getTime())) continue;

    const { seasonYear, weekNumber } = weekForSport(kickoff, sport);
    const weekId = liveWeekIds.get(`${seasonYear}-${weekNumber}`);
    if (!weekId) {
      result.gamesSkipped = (result.gamesSkipped ?? 0) + 1;
      continue;
    }

    const line = extractHomeSpread(event, preferred);
    let existing = byEvent.get(event.id) ?? null;

    if (!existing) {

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
        // A curated slate is a selection somebody made. Adding to it from the
        // feed would put fifty college games in front of members who were
        // offered twenty.
        if (sportConfig(sport).curatedSlate) {
          result.gamesSkipped = (result.gamesSkipped ?? 0) + 1;
          continue;
        }
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

    // Frozen at kickoff: nothing changes, ever.
    if (existing.spread_frozen_at) continue;

    // A locked line is yours and the feed must not move it -- but the schedule
    // is the NFL's. Flex scheduling moves kickoffs, and a stale kickoff freezes
    // picks at the old time, which could be hours early. So the time is kept
    // current even on a locked game; only the number is left alone.
    if (existing.spread_locked_at) {
      const moved = await db()
        .from("games")
        .update({
          kickoff_time: kickoff.toISOString(),
          kickoff_changed_at: now,
          last_seen_in_feed_at: now,
        })
        .eq("id", existing.id)
        .is("spread_frozen_at", null)
        .neq("kickoff_time", kickoff.toISOString())
        .select("id");
      if (!moved.error && moved.data && moved.data.length > 0) {
        result.kickoffsMoved = (result.kickoffsMoved ?? 0) + 1;
      }
      continue;
    }

    if (!line) continue;

    const update = await db()
      .from("games")
      .update({
        home_spread: line.spread,
        spread_source: line.source,
        spread_updated_at: now,
        kickoff_time: kickoff.toISOString(),
        last_seen_in_feed_at: now,
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
export async function refreshScores(
  daysFrom: number | null = null,
  sport: Sport = "nfl",
): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    gamesSeen: 0,
    gamesInserted: 0,
    spreadsUpdated: 0,
    scoresUpdated: 0,
  };

  // daysFrom asks for games that already finished, which The Odds API treats as
  // historical data and restricts to paid plans. Asking for it speculatively
  // meant every run made a request that a free plan refuses and then a second
  // one that works. The caller now passes it only when the open week actually
  // has a game old enough to need it, so the usual run is a single request.
  let events: ScoreEvent[];
  try {
    events = await getJson<ScoreEvent[]>(
      scoresEndpoint(sportConfig(sport).oddsApiKey),
      daysFrom === null
        ? { dateFormat: "iso" }
        : { daysFrom: String(daysFrom), dateFormat: "iso" },
    );
  } catch (first) {
    if (daysFrom === null) return { ...result, ok: false, error: describe(first) };
    try {
      // Fall back to the plain call, which still covers live and just-finished.
      events = await getJson<ScoreEvent[]>(scoresEndpoint(sportConfig(sport).oddsApiKey), {
        dateFormat: "iso",
      });
    } catch {
      return { ...result, ok: false, error: describe(first) };
    }
  }

  // A closed week is a finished snapshot, so scores stop landing in it too.
  const liveWeeks = (await listOpenedWeeks(sport))
    .filter((week) => week.closed_at === null)
    .map((week) => week.id);
  if (liveWeeks.length === 0) return result;

  for (const event of events) {
    result.gamesSeen += 1;

    // Every scores response carries commence_time, so keeping kickoffs current
    // costs nothing extra. This is what catches a flexed game between line
    // pulls, and it matters because the stored kickoff is what freezes picks.
    const kickoff = new Date(event.commence_time);
    if (!Number.isNaN(kickoff.getTime())) {
      const stamp = new Date().toISOString();
      const moved = await db()
        .from("games")
        .update({ kickoff_time: kickoff.toISOString(), kickoff_changed_at: stamp })
        .eq("odds_api_event_id", event.id)
        .in("week_id", liveWeeks)
        .is("spread_frozen_at", null)
        .neq("kickoff_time", kickoff.toISOString())
        .select("id");
      if (!moved.error && moved.data && moved.data.length > 0) {
        result.kickoffsMoved = (result.kickoffsMoved ?? 0) + 1;
      }
    }

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
      .in("week_id", liveWeeks)
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

// ------------------------------------------------------- deliberate pulls

/**
 * A week's slate and spreads, read straight from the odds feed.
 *
 * This is the fix for college football. Asking a model to search out twenty
 * games, their spreads, their kickoff times and their AP rankings cost a full
 * web-searching run every time, and the names and times it came back with were
 * approximate enough that validation threw the whole slate away. The feed
 * carries all of it exactly, for one request, so there is nothing left to
 * verify beyond which week a kickoff falls in. Only the poll still comes from
 * a model, and only because the feed has no poll.
 *
 * One request against the monthly quota. The lines are returned, not written:
 * the caller locks them through applyLockedLines exactly as it does a Claude
 * pull, so both routes behave the same from there on.
 */
export async function pullLinesFromFeed(
  seasonYear: number,
  weekNumber: number,
  sport: Sport,
  limit: number | null = null,
): Promise<PullResult> {
  const empty: PullResult = { ok: false, error: null, games: [], rejected: [], source: null };
  if (!process.env.ODDS_API_KEY) {
    return { ...empty, error: "No ODDS_API_KEY is set, so the odds feed is off." };
  }

  const config = sportConfig(sport);
  let events: OddsEvent[];
  try {
    events = await getJson<OddsEvent[]>(oddsEndpoint(config.oddsApiKey), {
      regions: "us",
      markets: "spreads",
      oddsFormat: "american",
      dateFormat: "iso",
    });
  } catch (error) {
    return { ...empty, error: describe(error) };
  }

  const preferred = env.oddsApiBookmakers;
  const rejected: string[] = [];
  const candidates: Candidate[] = [];
  const sources = new Set<string>();

  for (const event of events) {
    const kickoff = new Date(event.commence_time);
    if (Number.isNaN(kickoff.getTime())) continue;

    const placed = weekForSport(kickoff, sport, seasonYear);
    if (placed.weekNumber !== weekNumber) continue;
    if (config.saturdayOnly && !isSaturdayGame(kickoff)) continue;

    const line = extractHomeSpread(event, preferred);
    if (!line) {
      // Normal this far out, and worth naming: an admin can add it by hand.
      rejected.push(`${event.away_team} at ${event.home_team}: no spread posted yet`);
      continue;
    }

    sources.add(line.source);
    candidates.push({
      awayTeam: event.away_team,
      homeTeam: event.home_team,
      kickoffIso: kickoff.toISOString(),
      homeSpread: line.spread,
      homeRank: null,
      awayRank: null,
    });
  }

  if (candidates.length === 0) {
    return {
      ...empty,
      rejected,
      error:
        `The feed has no ${config.label} games for ${seasonYear} week ${weekNumber} yet. ` +
        "Books usually post a week's lines a few days out.",
    };
  }

  // The poll only matters where it is shown, and it has to be applied before
  // the slate is cut so the ranked games are the ones that survive the cut.
  if (config.ranked) {
    const poll = await fetchApTop25(seasonYear, weekNumber);
    if (poll.length > 0) {
      for (const game of candidates) {
        game.homeRank = rankFor(game.homeTeam, poll);
        game.awayRank = rankFor(game.awayTeam, poll);
      }
    }
  }

  const chosen = limit === null ? candidates : selectGames(candidates, limit);
  return {
    ok: true,
    error: null,
    games: chosen,
    rejected,
    source: sources.size === 1 ? [...sources][0] : "odds feed",
  };
}

export type FeedTotal = {
  awayTeam: string;
  homeTeam: string;
  total: number;
  source: string;
};

/**
 * Over/under numbers for a sport's current slate, one request.
 *
 * Kept apart from the spreads pull because the two are wanted at different
 * moments: the slate is set once a week, while a total is only worth fetching
 * for the games an admin has actually turned the over/under on for.
 */
export async function pullTotalsFromFeed(
  sport: Sport,
): Promise<{ ok: boolean; error: string | null; totals: FeedTotal[] }> {
  if (!process.env.ODDS_API_KEY) {
    return { ok: false, error: "No ODDS_API_KEY is set, so the odds feed is off.", totals: [] };
  }

  let events: OddsEvent[];
  try {
    events = await getJson<OddsEvent[]>(oddsEndpoint(sportConfig(sport).oddsApiKey), {
      regions: "us",
      markets: "totals",
      oddsFormat: "american",
      dateFormat: "iso",
    });
  } catch (error) {
    return { ok: false, error: describe(error), totals: [] };
  }

  const preferred = env.oddsApiBookmakers;
  const totals: FeedTotal[] = [];
  for (const event of events) {
    const found = extractTotal(event, preferred);
    if (!found) continue;
    totals.push({
      awayTeam: event.away_team,
      homeTeam: event.home_team,
      total: found.total,
      source: found.source,
    });
  }

  return { ok: true, error: null, totals };
}
