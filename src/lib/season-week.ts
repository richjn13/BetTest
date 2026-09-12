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
 * College football's Week 1, expressed the same way the NFL's is: the Tuesday
 * 08:00 UTC that opens it.
 *
 * The anchor is Labor Day. Week 1 is the weekend that ends on the first Monday
 * of September, so its Saturday is the Saturday before that Monday: 30 August
 * in 2025, 5 September in 2026. The earlier code anchored on the first
 * Saturday from 23 August, which is Week 0, and so numbered the whole season
 * one week light -- every game a pull returned was then rejected for landing
 * in the wrong week.
 *
 * Week 0 exists in college football, so the number is allowed to reach 0
 * rather than being clamped up to 1.
 */
export function ncaafSeasonStartUtc(seasonYear: number): number {
  const september = new Date(Date.UTC(seasonYear, 8, 1, BOUNDARY_HOUR_UTC));
  const daysToMonday = (8 - september.getUTCDay()) % 7;
  const firstMonday = september.getTime() + daysToMonday * MS_PER_DAY;
  // Six days back from that Monday is the Tuesday before Week 1's Saturday, so
  // a college week runs Tuesday to Monday exactly as an NFL week does.
  return firstMonday - 6 * MS_PER_DAY;
}

/** The week a college kickoff belongs to, counting Saturdays from the opener. */
export function ncaafWeekForKickoff(kickoff: Date, seasonYear?: number): SeasonWeek {
  const year = kickoff.getUTCFullYear();
  // Week 0 sits a week before Week 1, so the season boundary has to sit a week
  // earlier still; otherwise a late August opener is filed under last season.
  const season =
    seasonYear ??
    (kickoff.getTime() < ncaafSeasonStartUtc(year) - MS_PER_WEEK ? year - 1 : year);
  const elapsed = kickoff.getTime() - ncaafSeasonStartUtc(season);
  const raw = Math.floor(elapsed / MS_PER_WEEK) + 1;
  return { seasonYear: season, weekNumber: Math.min(16, Math.max(0, raw)) };
}

/**
 * The main game day of a week: the Sunday for the NFL, the Saturday for
 * college. Derived from the same anchors the week numbers come from, so it
 * needs no schedule and works for a week that has not been pulled yet.
 */
export function weekPlayDateUtc(
  seasonYear: number,
  weekNumber: number,
  sport: Sport,
): Date {
  const start =
    sport === "ncaaf"
      ? ncaafSeasonStartUtc(seasonYear)
      : seasonStartUtc(seasonYear);
  // Both weeks open on a Tuesday. Saturday is four days on, Sunday five.
  const dayOfWeek = sport === "ncaaf" ? 4 : 5;
  // The bye before the Super Bowl is why week 22 sits two weeks after the
  // conference championships rather than one; the same reason weekForKickoff
  // folds anything past 22 back onto it.
  const bye = sport === "nfl" && weekNumber === 22 ? MS_PER_WEEK : 0;
  return new Date(start + (weekNumber - 1) * MS_PER_WEEK + dayOfWeek * MS_PER_DAY + bye);
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
