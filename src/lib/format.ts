/** Display helpers shared by the picks board and the leaderboard. */

/**
 * The spread as it applies to one side. `homeSpread` is stored from the home
 * team's perspective, so the away side is its negation.
 */
export function spreadForSide(
  homeSpread: number | null,
  side: "home" | "away",
): string {
  if (homeSpread === null) return "--";
  const value = side === "home" ? homeSpread : -homeSpread;
  if (value === 0) return "PK";
  return value > 0 ? `+${trim(value)}` : `${trim(value)}`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/** "Sun 1:00 PM" in the viewer's own zone. */
export function formatKickoff(kickoff: string | Date): string {
  const date = typeof kickoff === "string" ? new Date(kickoff) : kickoff;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Coarse countdown: "3d 4h", "42m", or null once kickoff has passed. */
export function timeUntil(kickoff: string | Date, now: Date = new Date()): string | null {
  const date = typeof kickoff === "string" ? new Date(kickoff) : kickoff;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return null;

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function weekLabel(weekNumber: number, seasonType: string): string {
  if (seasonType === "regular") return `Week ${weekNumber}`;
  switch (weekNumber) {
    case 19:
      return "Wild Card";
    case 20:
      return "Divisional";
    case 21:
      return "Conference Championships";
    case 22:
      return "Super Bowl";
    default:
      return `Playoff Week ${weekNumber - 18}`;
  }
}
