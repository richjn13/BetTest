import type { GameStatus, PickResult, Side } from "./scoring";

export type { GameStatus, PickResult, Side };

export type Group = {
  id: string;
  name: string;
  join_code: string;
  admin_user_id: string | null;
  created_at: string;
};

export type User = {
  id: string;
  group_id: string;
  username: string;
  is_admin: boolean;
  created_at: string;
  display_name: string | null;
  email: string | null;
  /** Data URL of a small square image, or null. */
  avatar_url: string | null;
};

export type Week = {
  id: string;
  season_year: number;
  week_number: number;
  season_type: "regular" | "postseason";
  label: string;
  /** Null until lines are pulled. Members never see an unopened week. */
  opened_at: string | null;
  /** Set when the week is finished. Nothing may change it afterwards. */
  closed_at: string | null;
};

/** A week accepts picks and line updates only while it is open. */
export function isWeekOpen(week: Week): boolean {
  return week.opened_at !== null && week.closed_at === null;
}

export type Game = {
  id: string;
  week_id: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  home_spread: number | null;
  spread_source: string | null;
  spread_updated_at: string | null;
  spread_frozen_at: string | null;
  spread_locked_at: string | null;
  frozen_home_spread: number | null;
  final_home_score: number | null;
  final_away_score: number | null;
  score_overridden_at: string | null;
  status: GameStatus;
  odds_api_event_id: string | null;
};

export type Pick = {
  id: string;
  user_id: string;
  game_id: string;
  week_id: string;
  picked_side: Side;
  is_lock: boolean;
  locked_at: string | null;
  points_awarded: number | null;
};

export type AdminAction = {
  id: string;
  group_id: string;
  actor_username: string;
  action: string;
  target_user_id: string | null;
  game_id: string | null;
  note: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type PointAdjustment = {
  id: string;
  group_id: string;
  user_id: string;
  week_id: string | null;
  points: number;
  note: string;
  created_at: string;
};

/** A game plus the viewer's pick and whether it still accepts changes. */
export type GameCard = {
  game: Game;
  pick: Pick | null;
  isOpen: boolean;
  /** Other members' picks, revealed only once the game has kicked off. */
  revealed: { username: string; side: Side; isLock: boolean }[] | null;
};

/** The line a pick is graded against: frozen once kickoff passes. */
export function effectiveSpread(game: Game): number | null {
  return game.spread_frozen_at ? game.frozen_home_spread : game.home_spread;
}

/** Whether a game still accepts pick changes. Locking is strictly per-game. */
export function isGameOpen(game: Game, now: Date = new Date()): boolean {
  if (game.status === "postponed" || game.status === "canceled") return false;
  if (game.status !== "scheduled") return false;
  return new Date(game.kickoff_time).getTime() > now.getTime();
}
