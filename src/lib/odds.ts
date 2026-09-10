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
import { ensureWeek } from "./queries";

const API_BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
const REQUEST_TIMEOUT_MS = 10_000;

export type SyncResult = {
  ok: boolean;
  /** Why the run degraded, if it did. The last known spread stays on screen. */
  error?: string;
  gamesSeen: number;
  gamesInserted: number;
  spreadsUpdated: number;
  scoresUpdated: number;
};

// ------------------------------------------------------------------ fetch

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("apiKey", env.oddsApiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `The Odds API returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await response.json()) as T;
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
    events = await getJson<OddsEvent[]>("/odds", {
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

  for (const event of events) {
    result.gamesSeen += 1;
    const kickoff = new Date(event.commence_time);
    if (Number.isNaN(kickoff.getTime())) continue;

    const line = extractHomeSpread(event, preferred);

    const existing = unwrap(
      await db()
        .from("games")
        .select("id, spread_frozen_at")
        .eq("odds_api_event_id", event.id)
        .maybeSingle(),
    ) as { id: string; spread_frozen_at: string | null } | null;

    if (!existing) {
      const { seasonYear, weekNumber } = weekForKickoff(kickoff);
      const week = await ensureWeek(seasonYear, weekNumber);
      const insert = await db()
        .from("games")
        .insert({
          week_id: week.id,
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

    // Kickoff has passed and the line is frozen: never touch it again.
    if (existing.spread_frozen_at || !line) continue;

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

  let events: ScoreEvent[];
  try {
    events = await getJson<ScoreEvent[]>("/scores", {
      daysFrom: String(daysFrom),
      dateFormat: "iso",
    });
  } catch (error) {
    return { ...result, ok: false, error: describe(error) };
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
