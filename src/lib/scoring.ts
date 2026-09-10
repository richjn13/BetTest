/**
 * Grading a pick against the spread. Kept free of database and framework
 * imports so the rules can be tested directly.
 */

export type Side = "home" | "away";

export type GameStatus = "scheduled" | "live" | "final" | "postponed" | "canceled";

export type GradableGame = {
  status: GameStatus;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  /** The line picks are graded against: frozen at kickoff. */
  frozenHomeSpread: number | null;
};

export type GradablePick = {
  pickedSide: Side;
  isLock: boolean;
};

export type PickResult = "win" | "loss" | "push";

export const POINTS_WIN = 1;
export const POINTS_LOCK_WIN = 2;

/**
 * How the home team did against its own line. Positive means the home team
 * covered, negative means the away team covered, zero is a push.
 *
 * `homeSpread` is from the home team's perspective: -3.5 means the home team
 * is favored by 3.5 and must win by 4 or more to cover.
 */
export function coverMargin(
  homeScore: number,
  awayScore: number,
  homeSpread: number,
): number {
  return homeScore - awayScore + homeSpread;
}

/** The side that covered, or "push". A missing line grades the game straight up. */
export function winningSide(game: GradableGame): Side | "push" | null {
  if (game.finalHomeScore === null || game.finalAwayScore === null) return null;
  const margin = coverMargin(
    game.finalHomeScore,
    game.finalAwayScore,
    game.frozenHomeSpread ?? 0,
  );
  if (margin > 0) return "home";
  if (margin < 0) return "away";
  return "push";
}

/** Games that never resolved are dropped from the week rather than scored as losses. */
export function isExcluded(game: GradableGame): boolean {
  return game.status === "postponed" || game.status === "canceled";
}

/**
 * Points for one pick, or null when the game has not produced a result yet
 * (still scheduled or live) or is excluded from scoring entirely.
 */
export function gradePick(
  pick: GradablePick,
  game: GradableGame,
): { points: number; result: PickResult } | null {
  if (isExcluded(game)) return null;
  if (game.status !== "final") return null;

  const winner = winningSide(game);
  if (winner === null) return null;
  if (winner === "push") return { points: 0, result: "push" };
  if (winner !== pick.pickedSide) return { points: 0, result: "loss" };

  return { points: pick.isLock ? POINTS_LOCK_WIN : POINTS_WIN, result: "win" };
}

// ------------------------------------------------------------------ standings

export type ScoredPick = {
  userId: string;
  weekId: string;
  points: number | null;
  isLock: boolean;
  result: PickResult | null;
};

export type Adjustment = {
  userId: string;
  weekId: string | null;
  points: number;
};

export type WeekTotals = {
  weekId: string;
  points: number;
  /** Correct picks that were not the lock -- the weekly tiebreaker. */
  correctNonLock: number;
  correct: number;
  graded: number;
  pending: number;
};

export type Standing = {
  userId: string;
  totalPoints: number;
  correctNonLock: number;
  correct: number;
  weeks: WeekTotals[];
};

/**
 * Season standings from graded picks plus any manual adjustments. Ordered by
 * total points, then most correct non-lock picks; ties beyond that are broken
 * by the caller (we sort by user id last so the order is at least stable).
 */
export function buildStandings(
  userIds: string[],
  picks: ScoredPick[],
  adjustments: Adjustment[] = [],
): Standing[] {
  const byUser = new Map<string, Standing>();
  for (const userId of userIds) {
    byUser.set(userId, {
      userId,
      totalPoints: 0,
      correctNonLock: 0,
      correct: 0,
      weeks: [],
    });
  }

  const weekIndex = new Map<string, Map<string, WeekTotals>>();
  const weekFor = (userId: string, weekId: string): WeekTotals | null => {
    const standing = byUser.get(userId);
    if (!standing) return null;
    let weeks = weekIndex.get(userId);
    if (!weeks) {
      weeks = new Map();
      weekIndex.set(userId, weeks);
    }
    let totals = weeks.get(weekId);
    if (!totals) {
      totals = { weekId, points: 0, correctNonLock: 0, correct: 0, graded: 0, pending: 0 };
      weeks.set(weekId, totals);
      standing.weeks.push(totals);
    }
    return totals;
  };

  for (const pick of picks) {
    const standing = byUser.get(pick.userId);
    if (!standing) continue;
    const totals = weekFor(pick.userId, pick.weekId);
    if (!totals) continue;

    if (pick.points === null) {
      totals.pending += 1;
      continue;
    }
    totals.graded += 1;
    totals.points += pick.points;
    standing.totalPoints += pick.points;
    if (pick.result === "win") {
      totals.correct += 1;
      standing.correct += 1;
      if (!pick.isLock) {
        totals.correctNonLock += 1;
        standing.correctNonLock += 1;
      }
    }
  }

  for (const adjustment of adjustments) {
    const standing = byUser.get(adjustment.userId);
    if (!standing) continue;
    standing.totalPoints += adjustment.points;
    if (adjustment.weekId) {
      const totals = weekFor(adjustment.userId, adjustment.weekId);
      if (totals) totals.points += adjustment.points;
    }
  }

  return [...byUser.values()].sort(compareStandings);
}

export function compareStandings(a: Standing, b: Standing): number {
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  if (b.correctNonLock !== a.correctNonLock) return b.correctNonLock - a.correctNonLock;
  return a.userId.localeCompare(b.userId);
}
