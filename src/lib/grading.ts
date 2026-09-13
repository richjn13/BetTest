import "server-only";
import { db, unwrap } from "./db";
import { gradePick, gradeTotalPick, type GradableGame } from "./scoring";
import type { Side, TotalSide } from "./types";

/**
 * Only what grading actually reads. This used to select every column a game
 * has, which is a larger payload for no use, and a second copy of a list that
 * had already drifted out of step with the one in queries.
 */
const COLUMNS =
  "id, week_id, status, final_home_score, final_away_score, home_spread, " +
  "spread_frozen_at, frozen_home_spread, total_points, frozen_total";

type GradingGame = {
  id: string;
  week_id: string;
  status: GradableGame["status"];
  final_home_score: number | null;
  final_away_score: number | null;
  home_spread: number | null;
  spread_frozen_at: string | null;
  frozen_home_spread: number | null;
  total_points: number | null;
  frozen_total: number | null;
};

/** Writes go out together rather than one after another, in bounded batches. */
const BATCH = 25;

async function inBatches<T>(items: T[], work: (item: T) => Promise<boolean>): Promise<number> {
  let done = 0;
  for (let at = 0; at < items.length; at += BATCH) {
    const results = await Promise.all(items.slice(at, at + BATCH).map(work));
    done += results.filter(Boolean).length;
  }
  return done;
}

/**
 * Freezes the line on every game whose kickoff has passed. The frozen value is
 * what picks are graded against and is written exactly once -- later revisions
 * from the odds feed can no longer move it.
 */
export async function freezeKickedOffSpreads(now: Date = new Date()): Promise<number> {
  const games =
    (unwrap(
      await db()
        .from("games")
        .select(COLUMNS)
        .is("spread_frozen_at", null)
        .lte("kickoff_time", now.toISOString()),
    ) as GradingGame[]) ?? [];

  return inBatches(games, async (game) => {
    const result = await db()
      .from("games")
      .update({
        frozen_home_spread: game.home_spread,
        frozen_total: game.total_points,
        spread_frozen_at: now.toISOString(),
        // A game that reached kickoff is under way unless it was called off.
        status: game.status === "scheduled" ? "live" : game.status,
      })
      .eq("id", game.id)
      // Only the first writer freezes; a concurrent run matches nothing.
      .is("spread_frozen_at", null)
      .select("id");
    return !result.error && (result.data?.length ?? 0) > 0;
  });
}

/**
 * Recomputes points for every pick on a resolved game. Recomputing rather than
 * grading once means an admin score correction flows straight through to the
 * leaderboard on the next run.
 *
 * Without a list of games it grades the ones that can still change: a closed
 * or hidden week is settled, and re-reading every pick of the season on every
 * score check was work that grew all year and changed nothing.
 */
export async function gradeResolvedGames(gameIds?: string[]): Promise<number> {
  let query = db()
    .from("games")
    .select(COLUMNS)
    .in("status", ["final", "postponed", "canceled"]);

  if (gameIds && gameIds.length > 0) {
    query = query.in("id", gameIds);
  } else {
    const live =
      (unwrap(
        await db()
          .from("weeks")
          .select("id")
          .is("closed_at", null)
          .is("hidden_at", null),
      ) as { id: string }[]) ?? [];
    if (live.length === 0) return 0;
    query = query.in(
      "week_id",
      live.map((week) => week.id),
    );
  }

  const games = ((unwrap(await query) as GradingGame[]) ?? []).filter(
    (game) => game.status !== "final" || game.final_home_score !== null,
  );
  if (games.length === 0) return 0;

  const picks =
    (unwrap(
      await db()
        .from("picks")
        .select("id, game_id, picked_side, market, is_lock, points_awarded")
        .in(
          "game_id",
          games.map((game) => game.id),
        ),
    ) as {
      id: string;
      game_id: string;
      picked_side: Side | TotalSide;
      market: "spread" | "total";
      is_lock: boolean;
      points_awarded: number | null;
    }[]) ?? [];

  const byId = new Map(games.map((game) => [game.id, game]));

  // Work out every new score first, then write only the ones that moved.
  const changed: { id: string; points: number | null }[] = [];
  for (const pick of picks) {
    const raw = byId.get(pick.game_id);
    if (!raw) continue;

    const graded =
      pick.market === "total"
        ? gradeTotalPick(pick.picked_side as TotalSide, {
            status: raw.status,
            finalHomeScore: raw.final_home_score,
            finalAwayScore: raw.final_away_score,
            frozenTotal: raw.spread_frozen_at ? raw.frozen_total : raw.total_points,
          })
        : gradePick(
            { pickedSide: pick.picked_side as Side, isLock: pick.is_lock },
            toGradable(raw),
          );

    const points = graded === null ? null : graded.points;
    const current = pick.points_awarded === null ? null : Number(pick.points_awarded);
    if (current !== points) changed.push({ id: pick.id, points });
  }

  return inBatches(changed, async (pick) => {
    const result = await db()
      .from("picks")
      .update({ points_awarded: pick.points })
      .eq("id", pick.id)
      .select("id");
    return !result.error && (result.data?.length ?? 0) > 0;
  });
}

function toGradable(game: GradingGame): GradableGame {
  return {
    status: game.status,
    finalHomeScore: game.final_home_score,
    finalAwayScore: game.final_away_score,
    // Grade against the frozen line; fall back to the live one only for a game
    // that somehow reached final without ever being frozen.
    frozenHomeSpread: game.spread_frozen_at ? game.frozen_home_spread : game.home_spread,
  };
}
