import "server-only";
import { claimSlot, slotLastRun, sportsWithOpenWeeks } from "./queries";
import { pendingScores, runRefresh } from "./refresh";
import type { Sport } from "./sports";

/**
 * Checking scores when somebody looks, rather than only when a scheduler
 * remembers to.
 *
 * The GitHub schedule is best-effort and drops runs under load: three were due
 * in one hour here and one arrived. Waiting on it means a score that is half an
 * hour old at best and an hour old often, which on a Saturday afternoon is the
 * difference between a live pool and a dead one.
 *
 * So a page view does the check itself, under two conditions that keep it from
 * costing anything it should not:
 *
 * - a game in an open week has actually kicked off and has no final score yet,
 *   which is decided from stored data and is free;
 * - and nobody else has checked within the interval, which is claimed in the
 *   database so ten people watching at once still spend one call.
 *
 * Nobody watching costs nothing at all, which is the part a scheduler can
 * never manage.
 */

const MINUTES = Number(process.env.LIVE_REFRESH_MINUTES) || 10;
const SLOT = "scores:last-check";

/**
 * How recently a game must have kicked off to count as one somebody is
 * watching. Six hours covers the longest game and its overrun; beyond that it
 * is a game that never resolved, which is the scheduled run's problem and an
 * admin's, not something to spend a call on at every page view for a week.
 */
const WATCHING_WINDOW_MS = 6 * 60 * 60 * 1000;

export type LiveCheck = { ran: Sport[]; lastChecked: Date | null };

export async function refreshScoresIfStale(): Promise<LiveCheck> {
  let lastChecked: Date | null = null;
  try {
    lastChecked = await slotLastRun(SLOT);
  } catch {
    // The table may not exist yet on a deployment that has not run 0012.
    return { ran: [], lastChecked: null };
  }

  let waiting: Sport[] = [];
  try {
    const sports = await sportsWithOpenWeeks();
    const checks = await Promise.all(
      sports.map(async (sport) => ({
        sport,
        pending: await pendingScores(new Date(), sport, WATCHING_WINDOW_MS),
      })),
    );
    waiting = checks.filter((check) => check.pending.count > 0).map((check) => check.sport);
  } catch {
    return { ran: [], lastChecked };
  }

  if (waiting.length === 0) return { ran: [], lastChecked };

  let claimed = false;
  try {
    claimed = await claimSlot(SLOT, MINUTES * 60_000);
  } catch {
    return { ran: [], lastChecked };
  }
  if (!claimed) return { ran: [], lastChecked };

  const ran: Sport[] = [];
  for (const sport of waiting) {
    try {
      await runRefresh("scores", sport);
      ran.push(sport);
    } catch (error) {
      // A page must render even when the feed is down.
      console.error("live refresh failed", sport, error);
    }
  }

  return { ran, lastChecked: new Date() };
}
