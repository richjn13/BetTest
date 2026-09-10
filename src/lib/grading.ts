import "server-only";
import { db, unwrap } from "./db";
import { gradePick, type GradableGame } from "./scoring";
import type { Game, Side } from "./types";

const GAME_COLUMNS =
  "id, week_id, home_team, away_team, kickoff_time, home_spread, spread_source, " +
  "spread_updated_at, spread_frozen_at, frozen_home_spread, final_home_score, " +
  "final_away_score, score_overridden_at, status, odds_api_event_id";

/**
 * Freezes the line on every game whose kickoff has passed. The frozen value is
 * what picks are graded against and is written exactly once -- later revisions
 * from the odds feed can no longer move it.
 */
export async function freezeKickedOffSpreads(now: Date = new Date()): Promise<number> {
  const games = (unwrap(
    await db()
      .from("games")
      .select(GAME_COLUMNS)
      .is("spread_frozen_at", null)
      .lte("kickoff_time", now.toISOString()),
  ) as Game[]) ?? [];

  let frozen = 0;
  for (const game of games) {
    const result = await db()
      .from("games")
      .update({
        frozen_home_spread: game.home_spread,
        spread_frozen_at: now.toISOString(),
        // A game that reached kickoff is under way unless it was called off.
        status: game.status === "scheduled" ? "live" : game.status,
      })
      .eq("id", game.id)
      // Only the first writer freezes; a concurrent run matches nothing.
      .is("spread_frozen_at", null)
      .select("id");
    if (!result.error && result.data && result.data.length > 0) frozen += 1;
  }
  return frozen;
}

/**
 * Recomputes points for every pick on a resolved game. Recomputing rather than
 * grading once means an admin score correction flows straight through to the
 * leaderboard on the next run.
 */
export async function gradeResolvedGames(gameIds?: string[]): Promise<number> {
  let query = db()
    .from("games")
    .select(GAME_COLUMNS)
    .in("status", ["final", "postponed", "canceled"]);
  if (gameIds && gameIds.length > 0) query = query.in("id", gameIds);

  const games = ((unwrap(await query) as Game[]) ?? []).filter(
    (game) => game.status !== "final" || game.final_home_score !== null,
  );
  if (games.length === 0) return 0;

  const picks = (unwrap(
    await db()
      .from("picks")
      .select("id, game_id, picked_side, is_lock, points_awarded")
      .in(
        "game_id",
        games.map((game) => game.id),
      ),
  ) as {
    id: string;
    game_id: string;
    picked_side: Side;
    is_lock: boolean;
    points_awarded: number | null;
  }[]) ?? [];

  const byId = new Map(games.map((game) => [game.id, toGradable(game)]));

  let updated = 0;
  for (const pick of picks) {
    const game = byId.get(pick.game_id);
    if (!game) continue;
    const graded = gradePick({ pickedSide: pick.picked_side, isLock: pick.is_lock }, game);
    const points = graded === null ? null : graded.points;
    const current = pick.points_awarded === null ? null : Number(pick.points_awarded);
    if (current === points) continue;

    unwrap(
      await db().from("picks").update({ points_awarded: points }).eq("id", pick.id).select("id"),
    );
    updated += 1;
  }
  return updated;
}

function toGradable(game: Game): GradableGame {
  return {
    status: game.status,
    finalHomeScore: game.final_home_score,
    finalAwayScore: game.final_away_score,
    // Grade against the frozen line; fall back to the live one only for a game
    // that somehow reached final without ever being frozen.
    frozenHomeSpread: game.spread_frozen_at ? game.frozen_home_spread : game.home_spread,
  };
}
