/**
 * Grouping the two competitions' weeks into one weekend.
 *
 * The sports number their weeks from different starting points, so NFL week 1
 * and college week 2 can be the same Saturday and Sunday. For a pool that
 * plays both, that is one weekend and should be one score: which number each
 * league happens to put on it is their business, not the pool's.
 *
 * The grouping is derived from the calendar rather than set by hand. A week's
 * main game day is known from its number, and the Tuesday before it is the same
 * Tuesday for both sports of the same weekend, so that Tuesday is the identity.
 *
 * Kept free of database and framework imports so it can be tested directly.
 */
import { weekPlayDateUtc } from "./season-week";
import type { Sport } from "./sports";

const MS_PER_DAY = 86_400_000;
const BOUNDARY_HOUR_UTC = 8;
const TUESDAY = 2;

export type WeekLike = {
  id: string;
  season_year: number;
  week_number: number;
  sport: Sport;
  label: string;
};

export type Weekend = {
  /** The opening Tuesday as a date, which is what makes two weeks the same one. */
  key: string;
  /** Position in the season, counting the weekends this pool actually played. */
  number: number;
  /** "Sep 12", the Saturday that opens the weekend's football. */
  played: Date;
  weeks: WeekLike[];
};

/** The Tuesday 08:00 UTC that opens the weekend containing this moment. */
export function weekendStartUtc(at: Date): number {
  const sameDay = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    BOUNDARY_HOUR_UTC,
  );
  // Before 08:00 belongs to the day before: a west coast game finishing at
  // 03:00 UTC on Sunday is Saturday night's football.
  const anchored = sameDay > at.getTime() ? sameDay - MS_PER_DAY : sameDay;
  const back = (new Date(anchored).getUTCDay() - TUESDAY + 7) % 7;
  return anchored - back * MS_PER_DAY;
}

/** The weekend a week belongs to, as a date string. */
export function weekendKey(week: WeekLike): string {
  const played = weekPlayDateUtc(week.season_year, week.week_number, week.sport);
  return new Date(weekendStartUtc(played)).toISOString().slice(0, 10);
}

/**
 * Every week folded into its weekend, earliest first.
 *
 * Weekends are numbered by their order here rather than by either league's
 * week number, so the column a pool reads as "3" is its own third weekend.
 */
export function groupIntoWeekends(weeks: WeekLike[]): Weekend[] {
  const byKey = new Map<string, WeekLike[]>();
  for (const week of weeks) {
    const key = weekendKey(week);
    const existing = byKey.get(key);
    if (existing) existing.push(week);
    else byKey.set(key, [week]);
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group], index) => ({
      key,
      number: index + 1,
      // The Saturday: four days on from the opening Tuesday.
      played: new Date(Date.parse(`${key}T${String(BOUNDARY_HOUR_UTC).padStart(2, "0")}:00:00Z`) + 4 * MS_PER_DAY),
      weeks: [...group].sort((first, second) => first.sport.localeCompare(second.sport)),
    }));
}
