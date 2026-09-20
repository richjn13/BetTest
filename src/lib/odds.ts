import "server-only";
import { db, unwrap } from "./db";
import { env } from "./env";
import { weekForSport } from "./season-week";
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
import { rankFor, type PollEntry } from "./rankings";
import {
  SPORTS_ENDPOINT,
  oddsApiUrl,
  oddsEndpoint,
  readableError,
  scoresEndpoint,
  type Endpoint,
} from "./odds-url";
import { sportConfig, type Sport } from "./sports";
import { listOpenedWeeks, recordValue } from "./queries";

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
  /** How many games the feed answered with, matched or not. */
  eventsReturned?: number;
  /** Our games past kickoff that the feed never mentioned. */
  unmatched?: string[];
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

/** What each key last reported, keyed by the key itself. */
const quotaByKey = new Map<string, Quota>();

/** Quota counters from the most recent call this process made. */
export function lastKnownQuota(): Quota {
  return lastQuota;
}

/** How a key is named in a message: never the key itself. */
export function keyLabel(key: string): string {
  return `...${key.slice(-4)}`;
}

export const QUOTA_KEY = "odds:quota";

export type RememberedQuota = Quota & { at: string };

/**
 * The balance is written down whenever a call is made, so a page can show it
 * without making one of its own. The admin page used to probe the feed on
 * every single load -- an outbound request before anything rendered, for a
 * number that only changes when a call is spent.
 */
async function rememberQuota(quota: Quota): Promise<void> {
  if (quota.remaining === null) return;
  try {
    await recordValue(QUOTA_KEY, { ...quota, at: new Date().toISOString() });
  } catch {
    // Showing a stale balance is not worth failing a pull over.
  }
}

/** A key that answered 401, or reported nothing left, is not worth retrying. */
function spent(quota: Quota): boolean {
  return quota.remaining !== null && quota.remaining <= 0;
}

/**
 * Calls the feed, trying each configured key in turn.
 *
 * A key is passed over when it has already told us it has nothing left, and
 * moved past when it answers 401 (wrong or cancelled) or 429 (out). Anything
 * else -- a bad request, an outage -- is the same for every key, so it is
 * raised rather than burning through the list.
 */
async function getJson<T>(path: Endpoint, params: Record<string, string> = {}): Promise<T> {
  const keys = env.oddsApiKeys;
  if (keys.length === 0) throw new OddsApiError("No ODDS_API_KEY is set.", 0);

  const usable = keys.filter((key) => !spent(quotaByKey.get(key) ?? { remaining: null, used: null }));
  const order = usable.length > 0 ? usable : keys;

  let last: unknown;
  for (const [index, key] of order.entries()) {
    const response = await fetch(oddsApiUrl(path, key, params), {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const quota = readQuota(response);
    quotaByKey.set(key, quota);
    lastQuota = quota;
    await rememberQuota(quota);

    if (response.ok) return (await response.json()) as T;

    const body = readableError(await response.text().catch(() => ""));
    last = new OddsApiError(
      `The Odds API returned ${response.status} for key ${keyLabel(key)}` +
        `${body ? `: ${body}` : ""}`,
      response.status,
    );

    // Only a key-shaped failure is worth trying the next key for.
    const keyProblem = response.status === 401 || response.status === 429;
    if (!keyProblem || index === order.length - 1) throw last;
  }

  throw last ?? new OddsApiError("Every key was refused.", 401);
}

/**
 * Checks the key without spending quota. The /sports endpoint is free, so this
 * can be called from a diagnostics page as often as you like.
 */
export type KeyProbe = {
  label: string;
  ok: boolean;
  status: number | null;
  message: string;
  quota: Quota;
};

export async function probeOddsFeed(): Promise<{
  ok: boolean;
  status: number | null;
  message: string;
  quota: Quota;
  /** One entry per configured key, so two people can each see their own. */
  keys: KeyProbe[];
}> {
  const keys = env.oddsApiKeys;
  if (keys.length === 0) {
    return {
      ok: false,
      status: null,
      message: "No key set. The odds feed is off until you add one.",
      quota: { remaining: null, used: null },
      keys: [],
    };
  }

  // The sports listing is not billed, so every key can be checked without
  // spending anything. They go out together.
  const probes = await Promise.all(
    keys.map(async (key): Promise<KeyProbe> => {
      try {
        const response = await fetch(oddsApiUrl(SPORTS_ENDPOINT, key), {
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const quota = readQuota(response);
        quotaByKey.set(key, quota);

        if (!response.ok) {
          const body = readableError(await response.text().catch(() => ""));
          return {
            label: keyLabel(key),
            ok: false,
            status: response.status,
            quota,
            message:
              response.status === 401
                ? "Rejected. Check for a typo, and that you redeployed after setting it."
                : `The feed answered ${response.status}${body ? `: ${body}` : ""}`,
          };
        }

        return {
          label: keyLabel(key),
          ok: true,
          status: 200,
          quota,
          message:
            quota.remaining === null
              ? "Works."
              : `Works. ${quota.remaining} calls left this month.`,
        };
      } catch (error) {
        return {
          label: keyLabel(key),
          ok: false,
          status: null,
          quota: { remaining: null, used: null },
          message: describe(error),
        };
      }
    }),
  );

  const working = probes.filter((probe) => probe.ok);
  const total = working.reduce(
    (sum, probe) => (probe.quota.remaining === null ? sum : sum + probe.quota.remaining),
    0,
  );

  return {
    ok: working.length > 0,
    status: working.length > 0 ? 200 : (probes[0]?.status ?? null),
    quota: { remaining: working.length > 0 ? total : null, used: null },
    keys: probes,
    message:
      working.length === 0
        ? (probes[0]?.message ?? "No key worked.")
        : probes.length === 1
          ? probes[0].message
          : `${working.length} of ${probes.length} keys work, ${total} calls left between them.`,
  };
}

// ------------------------------------------------------------------- sync

/**
 * Pulls the current NFL slate and spreads, creating any game we have not seen
 * and refreshing the line on every game that has not yet frozen at kickoff.
 *
 * A failed fetch is reported, not thrown: the stored spreads stay exactly as
 * they were, so members keep seeing the last known line instead of an error.
 */
export async function refreshOdds(
  sport: Sport = "nfl",
  onlyWeekIds: string[] | null = null,
): Promise<SyncResult> {
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
  // A closed week is a finished snapshot and never receives anything. Beyond
  // that, a targeted run touches only the week it was asked for.
  const live = (await listOpenedWeeks(sport))
    .filter((week) => week.closed_at === null)
    .filter((week) => onlyWeekIds === null || onlyWeekIds.includes(week.id));
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
  onlyWeekIds: string[] | null = null,
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
    .filter((week) => onlyWeekIds === null || onlyWeekIds.includes(week.id))
    .map((week) => week.id);
  if (liveWeeks.length === 0) return result;

  // The scores feed answers with every game the league is playing, which for
  // college is well over fifty. Writing blindly meant two database round trips
  // per event whether or not we had the game, so a single college run made
  // hundreds of calls and could outlast the function's time limit. Reading the
  // week's games once, up front, turns that into one query plus a write for
  // the games that actually changed.
  type Row = {
    id: string;
    odds_api_event_id: string | null;
    kickoff_time: string;
    home_team: string;
    away_team: string;
    final_home_score: number | null;
    final_away_score: number | null;
    status: string;
    spread_frozen_at: string | null;
    score_overridden_at: string | null;
  };

  // Every game of the live weeks, event id or not. Keying only on the event id
  // meant a game the feed had renumbered, or one added by hand, could never be
  // scored however many times the feed was asked -- and the run reported no
  // error, because from its side nothing had gone wrong.
  const rows =
    unwrap<Row[]>(
      await db()
        .from("games")
        .select(
          "id, odds_api_event_id, kickoff_time, home_team, away_team, " +
            "final_home_score, final_away_score, status, spread_frozen_at, " +
            "score_overridden_at",
        )
        .in("week_id", liveWeeks),
    ) ?? [];

  const ours = new Map<string, Row>();
  const byMatchup = new Map<string, Row>();
  for (const row of rows) {
    if (row.odds_api_event_id) ours.set(row.odds_api_event_id, row);
    byMatchup.set(matchupKey(row.away_team, row.home_team), row);
  }

  result.eventsReturned = events.length;
  const matched = new Set<string>();

  for (const event of events) {
    let game = ours.get(event.id);

    // The same matchup by name, the way the odds pull already adopts one. The
    // feed writes both sides exactly as it wrote them when the slate was
    // pulled, so this is the reliable second key.
    if (!game) {
      const sameTeams = byMatchup.get(matchupKey(event.away_team, event.home_team));
      if (!sameTeams) continue;
      // Two weeks of a season can hold the same matchup, and a name alone
      // cannot tell them apart. The kickoff can: a rematch is never two days
      // away from the first meeting.
      const apart = Math.abs(
        new Date(sameTeams.kickoff_time).getTime() - new Date(event.commence_time).getTime(),
      );
      if (!Number.isFinite(apart) || apart > 2 * 86_400_000) continue;
      game = sameTeams;
      if (!game.odds_api_event_id) {
        const link = await db()
          .from("games")
          .update({ odds_api_event_id: event.id })
          .eq("id", game.id)
          .is("odds_api_event_id", null)
          .select("id");
        if (!link.error && (link.data?.length ?? 0) > 0) {
          game.odds_api_event_id = event.id;
          result.gamesAdopted = (result.gamesAdopted ?? 0) + 1;
        }
      }
    }

    matched.add(game.id);
    result.gamesSeen += 1;

    // Every scores response carries commence_time, so keeping kickoffs current
    // costs nothing extra. This is what catches a flexed game between line
    // pulls, and it matters because the stored kickoff is what freezes picks.
    const kickoff = new Date(event.commence_time);
    if (
      !Number.isNaN(kickoff.getTime()) &&
      game.spread_frozen_at === null &&
      game.kickoff_time !== kickoff.toISOString()
    ) {
      const moved = await db()
        .from("games")
        .update({
          kickoff_time: kickoff.toISOString(),
          kickoff_changed_at: new Date().toISOString(),
        })
        .eq("id", game.id)
        .is("spread_frozen_at", null)
        .select("id");
      if (!moved.error && moved.data && moved.data.length > 0) {
        result.kickoffsMoved = (result.kickoffsMoved ?? 0) + 1;
      }
    }

    if (game.score_overridden_at) continue;

    const parsed = extractScores(event);
    if (!parsed) continue;

    // Nothing to write when the feed is repeating what we already stored,
    // which is most of what a run every fifteen minutes sees.
    const status = event.completed ? "final" : "live";
    if (
      game.final_home_score === parsed.home &&
      game.final_away_score === parsed.away &&
      game.status === status
    ) {
      continue;
    }

    const update = await db()
      .from("games")
      .update({
        final_home_score: parsed.home,
        final_away_score: parsed.away,
        status,
      })
      .eq("id", game.id)
      .is("score_overridden_at", null)
      .select("id");
    if (!update.error && update.data && update.data.length > 0) result.scoresUpdated += 1;
  }

  // Games past kickoff that the feed said nothing about. A run that writes
  // nothing is otherwise indistinguishable from a quiet afternoon, which is
  // how a whole Saturday of college scores went missing without one error.
  const now = Date.now();
  result.unmatched = rows
    .filter(
      (row) =>
        !matched.has(row.id) &&
        row.status !== "final" &&
        new Date(row.kickoff_time).getTime() <= now,
    )
    .map((row) => `${row.away_team} at ${row.home_team}`);

  return result;
}

/** Both teams, lowercased, as the second way to recognise one of our games. */
function matchupKey(away: string, home: string): string {
  return `${away.trim().toLowerCase()}|${home.trim().toLowerCase()}`;
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
  poll: PollEntry[] = [],
): Promise<PullResult & { quota?: Quota }> {
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

  // Rankings are applied before the pool is cut, so the ranked games are the
  // ones that survive it. The poll is handed in already fetched: this function
  // talks to the odds feed and nothing else, which is what keeps a pull one
  // HTTP request and no model tokens at all.
  if (config.ranked && poll.length > 0) {
    for (const game of candidates) {
      game.homeRank = rankFor(game.homeTeam, poll);
      game.awayRank = rankFor(game.awayTeam, poll);
    }
  }

  const chosen = limit === null ? candidates : selectGames(candidates, limit);
  return {
    ok: true,
    error: null,
    games: chosen,
    rejected,
    source: sources.size === 1 ? [...sources][0] : "odds feed",
    quota: lastKnownQuota(),
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
): Promise<{ ok: boolean; error: string | null; totals: FeedTotal[]; quota?: Quota }> {
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

  return { ok: true, error: null, totals, quota: lastKnownQuota() };
}
