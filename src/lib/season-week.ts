import type { Sport } from "./sports";

/**
 * The Odds API returns kickoff times but no week numbers, so weeks are derived
 * from the calendar.
 *
 * The NFL week runs Thursday through Monday night. We put the boundary at
 * Tuesday 08:00 UTC (early Tuesday morning US time), which is safely after
 * Monday Night Football ends and before any Thursday game.
 *
 * Week 1's Thursday is the Thursday after Labor Day, so Week 1 begins on the
 * Tuesday right after the first Monday in September.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const BOUNDARY_HOUR_UTC = 8;

/**
 * Milliseconds for the Tuesday that opens Week 1 of the given season.
 *
 * NFL_WEEK1_TUESDAY overrides the derivation for a season whose schedule does
 * not follow the Labor Day rule; it applies to that one season only.
 */
export function seasonStartUtc(seasonYear: number): number {
  const override = seasonStartOverride();
  if (override !== null && new Date(override).getUTCFullYear() === seasonYear) {
    return override;
  }
  // Find the first Monday in September, then step one day to Tuesday.
  const september = new Date(Date.UTC(seasonYear, 8, 1, BOUNDARY_HOUR_UTC));
  const dayOfWeek = september.getUTCDay(); // 0 Sunday .. 6 Saturday
  const daysToMonday = (8 - dayOfWeek) % 7; // 1 is Monday
  const firstMonday = september.getTime() + daysToMonday * MS_PER_DAY;
  return firstMonday + MS_PER_DAY;
}

/**
 * Which season a kickoff belongs to. January and February games are the
 * playoffs of the season that started the previous autumn.
 */
export function seasonYearFor(kickoff: Date): number {
  const year = kickoff.getUTCFullYear();
  return kickoff.getTime() < seasonStartUtc(year) ? year - 1 : year;
}

export type SeasonWeek = { seasonYear: number; weekNumber: number };

/**
 * The season and week a kickoff falls in. Week numbers run 1-18 for the
 * regular season and 19-22 for wild card through the Super Bowl.
 *
 * The playoff calendar has a bye week between the conference championships and
 * the Super Bowl, so the raw week arithmetic overshoots by one for the final
 * game; weeks past 22 are folded back onto 22.
 */
export function weekForKickoff(kickoff: Date, seasonYear?: number): SeasonWeek {
  const season = seasonYear ?? seasonYearFor(kickoff);
  const elapsed = kickoff.getTime() - seasonStartUtc(season);
  const raw = Math.floor(elapsed / MS_PER_WEEK) + 1;
  return { seasonYear: season, weekNumber: Math.min(22, Math.max(1, raw)) };
}

/** Parses NFL_WEEK1_TUESDAY, the season start override. */
function seasonStartOverride(): number | null {
  const raw = process.env.NFL_WEEK1_TUESDAY;
  if (!raw) return null;
  const parsed = Date.parse(`${raw}T${String(BOUNDARY_HOUR_UTC).padStart(2, "0")}:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

// --------------------------------------------------------------- college

/**
 * College football's week 1 Saturday. The season opens on the last weekend of
 * August or the first of September, so the first Saturday on or after the 23rd
 * is the anchor.
 */
export function ncaafSeasonStartUtc(seasonYear: number): number {
  const august = new Date(Date.UTC(seasonYear, 7, 23, BOUNDARY_HOUR_UTC));
  const daysToSaturday = (6 - august.getUTCDay() + 7) % 7;
  return august.getTime() + daysToSaturday * MS_PER_DAY;
}

/**
 * Is this kickoff on a Saturday, in the sense that matters for college
 * football? The window runs from Saturday noon UTC, which is morning on the
 * east coast, to Sunday 09:00 UTC, which is after the latest west coast game.
 */
export function isSaturdayGame(kickoff: Date): boolean {
  const day = kickoff.getUTCDay();
  const hour = kickoff.getUTCHours();
  if (day === 6) return hour >= 12;
  if (day === 0) return hour < 9;
  return false;
}

/** The week a college kickoff belongs to, counting Saturdays from the opener. */
export function ncaafWeekForKickoff(kickoff: Date, seasonYear?: number): SeasonWeek {
  const year = kickoff.getUTCFullYear();
  const season =
    seasonYear ?? (kickoff.getTime() < ncaafSeasonStartUtc(year) ? year - 1 : year);
  const elapsed = kickoff.getTime() - ncaafSeasonStartUtc(season);
  const raw = Math.floor(elapsed / MS_PER_WEEK) + 1;
  return { seasonYear: season, weekNumber: Math.min(16, Math.max(1, raw)) };
}

/** Week derivation for either sport. */
export function weekForSport(
  kickoff: Date,
  sport: Sport,
  seasonYear?: number,
): SeasonWeek {
  return sport === "ncaaf"
    ? ncaafWeekForKickoff(kickoff, seasonYear)
    : weekForKickoff(kickoff, seasonYear);
}
