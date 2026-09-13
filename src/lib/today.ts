/**
 * Which competition to open on.
 *
 * Landing on college on a Sunday afternoon is a tap wasted every time, so the
 * page opens on whatever is actually being played. The answer comes from the
 * games themselves rather than from the day of the week, which means it copes
 * with a Thursday night NFL game, a Friday college game and a bowl season
 * without any of them being special cases.
 *
 * Kept free of database and framework imports so the rule can be tested.
 */
import type { Sport } from "./sports";

const MS_PER_DAY = 86_400_000;
/**
 * A football day runs from 08:00 UTC, which is the small hours in the United
 * States. Without that, a Saturday night game kicking off at 8pm Eastern is
 * Sunday by the clock and would open the app on the NFL.
 */
const DAY_STARTS_AT_UTC = 8;

export type DaySlate = {
  sport: Sport;
  games: { kickoff: string; status: string }[];
};

/** The start of the football day containing this moment. */
export function dayStartUtc(now: Date): number {
  const sameDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    DAY_STARTS_AT_UTC,
  );
  return sameDay > now.getTime() ? sameDay - MS_PER_DAY : sameDay;
}

/**
 * The competition being played today, or null when neither is.
 *
 * A game under way wins outright. Otherwise it is whichever has the earliest
 * kickoff still to come today, so a Sunday morning opens on the NFL before a
 * ball has been thrown.
 */
export function sportInPlay(slates: DaySlate[], now: Date = new Date()): Sport | null {
  const from = dayStartUtc(now);
  const until = from + MS_PER_DAY;
  const at = now.getTime();

  let live: { sport: Sport; kickoff: number } | null = null;
  let next: { sport: Sport; kickoff: number } | null = null;

  for (const slate of slates) {
    for (const game of slate.games) {
      const kickoff = new Date(game.kickoff).getTime();
      if (Number.isNaN(kickoff) || kickoff < from || kickoff >= until) continue;

      const finished = game.status === "final";
      const started = kickoff <= at;

      if (started && !finished) {
        // Whichever has been on longest: that is the one being watched.
        if (live === null || kickoff < live.kickoff) live = { sport: slate.sport, kickoff };
      } else if (!started) {
        if (next === null || kickoff < next.kickoff) next = { sport: slate.sport, kickoff };
      }
    }
  }

  return live?.sport ?? next?.sport ?? null;
}
