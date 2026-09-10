/**
 * Checking what Claude reported before it can reach the database.
 *
 * The numbers come from a model reading a web page, so every row is a proposal
 * until it passes these checks. A row that fails is dropped and named rather
 * than silently corrected -- a quietly wrong spread would freeze at kickoff and
 * mis-score everyone.
 *
 * Kept free of server imports so the rules can be tested directly.
 */
import { NFL_TEAMS } from "./teams";
import { seasonStartUtc } from "./nfl-week";

export type ProposedGame = {
  awayTeam: string;
  homeTeam: string;
  kickoffIso: string;
  homeSpread: number;
};

export type PullResult = {
  ok: boolean;
  error: string | null;
  games: ProposedGame[];
  /** Rows the model returned that failed validation, with the reason. */
  rejected: string[];
  source: string | null;
};

// ------------------------------------------------------------- validation

const TEAMS_BY_LOWER = new Map(NFL_TEAMS.map((team) => [team.toLowerCase(), team]));
/** Beyond this, a line is a transcription error rather than a real number. */
const MAX_PLAUSIBLE_SPREAD = 30;
/** How far from the week's nominal start a kickoff may sit, in days. */
const WEEK_WINDOW_DAYS = 8;

function resolveTeam(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return TEAMS_BY_LOWER.get(name.trim().toLowerCase()) ?? null;
}

export function validate(
  input: unknown,
  seasonYear: number,
  weekNumber: number,
): PullResult {
  const result: PullResult = { ok: true, error: null, games: [], rejected: [], source: null };

  const payload = input as { games?: unknown[]; source?: unknown };
  if (!Array.isArray(payload?.games)) {
    return { ...result, ok: false, error: "Claude's reply did not contain a list of games." };
  }
  result.source = typeof payload.source === "string" ? payload.source : null;

  const weekStart = seasonStartUtc(seasonYear) + (weekNumber - 1) * 7 * 86_400_000;
  const windowMs = WEEK_WINDOW_DAYS * 86_400_000;
  const seen = new Set<string>();

  for (const raw of payload.games) {
    const row = raw as Record<string, unknown>;
    const label = `${String(row.away_team)} at ${String(row.home_team)}`;

    const awayTeam = resolveTeam(row.away_team);
    const homeTeam = resolveTeam(row.home_team);
    if (!awayTeam || !homeTeam) {
      result.rejected.push(`${label}: not a recognized NFL team`);
      continue;
    }
    if (awayTeam === homeTeam) {
      result.rejected.push(`${label}: a team cannot play itself`);
      continue;
    }

    const kickoff = new Date(String(row.kickoff_iso));
    if (Number.isNaN(kickoff.getTime())) {
      result.rejected.push(`${label}: kickoff time could not be read`);
      continue;
    }
    if (Math.abs(kickoff.getTime() - weekStart) > windowMs) {
      result.rejected.push(
        `${label}: kickoff ${kickoff.toISOString().slice(0, 10)} is outside week ${weekNumber}`,
      );
      continue;
    }

    const spread = Number(row.home_spread);
    if (!Number.isFinite(spread)) {
      result.rejected.push(`${label}: spread is not a number`);
      continue;
    }
    if (Math.abs(spread) > MAX_PLAUSIBLE_SPREAD) {
      result.rejected.push(`${label}: spread of ${spread} is implausible`);
      continue;
    }
    // Spreads move in half points. Anything else was misread.
    if (Math.round(spread * 2) !== spread * 2) {
      result.rejected.push(`${label}: spread of ${spread} is not a half point`);
      continue;
    }

    const key = `${awayTeam}@${homeTeam}`;
    if (seen.has(key)) {
      result.rejected.push(`${label}: listed more than once`);
      continue;
    }
    seen.add(key);

    result.games.push({
      awayTeam,
      homeTeam,
      kickoffIso: kickoff.toISOString(),
      homeSpread: spread,
    });
  }

  if (result.games.length === 0) {
    return {
      ...result,
      ok: false,
      error: "Nothing Claude returned passed validation.",
    };
  }
  return result;
}
