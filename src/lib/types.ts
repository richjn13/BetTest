import type { GameStatus, Market, PickResult, Side, TotalSide } from "./scoring";
import type { Sport } from "./sports";

export type { GameStatus, Market, PickResult, Side, TotalSide };

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
  sport: Sport;
  /** Null until lines are pulled. Members never see an unopened week. */
  opened_at: string | null;
  /** Set when the week is finished. Nothing may change it afterwards. */
  closed_at: string | null;
};

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
  /** When this kickoff last moved. Null means it never has. */
  kickoff_changed_at: string | null;
  /** When a line pull last saw this game on the slate. */
  last_seen_in_feed_at: string | null;
  /** Poll position when the week was pulled. College only, null if unranked. */
  home_rank: number | null;
  away_rank: number | null;
  /** Over/under, off unless an admin turns it on and enters a number. */
  /** When an admin took this game out of the slate. Null means it is in. */
  excluded_at: string | null;
  total_points: number | null;
  frozen_total: number | null;
  totals_enabled: boolean;
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
  picked_side: Side | TotalSide;
  market: Market;
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
  /** Other members' spread picks, revealed only once the game has kicked off. */
  revealed: { username: string; side: Side; isLock: boolean }[] | null;
  /** How the whole group split on this game. Null until kickoff. */
  consensus: { total: number; home: number; away: number } | null;
  /** The viewer's over/under pick, when the game carries one. */
  totalPick: Pick | null;
};

/** The line a pick is graded against: frozen once kickoff passes. */
export function effectiveSpread(game: Game): number | null {
  return game.spread_frozen_at ? game.frozen_home_spread : game.home_spread;
}

/** The over/under a pick is graded against, on the same rule. */
export function effectiveTotal(game: Game): number | null {
  return game.spread_frozen_at ? game.frozen_total : game.total_points;
}

/** Whether a game still accepts pick changes. Locking is strictly per-game. */
export function isGameOpen(game: Game, now: Date = new Date()): boolean {
  if (game.status === "postponed" || game.status === "canceled") return false;
  if (game.status !== "scheduled") return false;
  return new Date(game.kickoff_time).getTime() > now.getTime();
}
