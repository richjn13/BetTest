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
import { isSaturdayGame, weekForSport } from "./season-week";
import { sportConfig, type Sport } from "./sports";

export type ProposedGame = {
  awayTeam: string;
  homeTeam: string;
  kickoffIso: string;
  homeSpread: number;
  /** Poll position, college only. Null when unranked or not applicable. */
  homeRank: number | null;
  awayRank: number | null;
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

/** College team names come from the feed, so only the shape is checked. */
function readTeamName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 60 ? trimmed : null;
}

function resolveTeam(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return TEAMS_BY_LOWER.get(name.trim().toLowerCase()) ?? null;
}

function readRank(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) return null;
  return parsed;
}

export function validate(
  input: unknown,
  seasonYear: number,
  weekNumber: number,
  sport: Sport = "nfl",
): PullResult {
  const config = sportConfig(sport);
  const result: PullResult = { ok: true, error: null, games: [], rejected: [], source: null };

  const payload = input as { games?: unknown[]; source?: unknown };
  if (!Array.isArray(payload?.games)) {
    return { ...result, ok: false, error: "Claude's reply did not contain a list of games." };
  }
  result.source = typeof payload.source === "string" ? payload.source : null;

  const seen = new Set<string>();

  for (const raw of payload.games) {
    const row = raw as Record<string, unknown>;
    const label = `${String(row.away_team)} at ${String(row.home_team)}`;

    // The NFL has thirty-two known names worth checking against. College has
    // well over a hundred that change, so there the feed is the authority and
    // only the shape of the name is checked.
    const awayTeam = sport === "nfl" ? resolveTeam(row.away_team) : readTeamName(row.away_team);
    const homeTeam = sport === "nfl" ? resolveTeam(row.home_team) : readTeamName(row.home_team);
    if (!awayTeam || !homeTeam) {
      result.rejected.push(
        `${label}: ${sport === "nfl" ? "not a recognized NFL team" : "team name could not be read"}`,
      );
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
    if (config.saturdayOnly && !isSaturdayGame(kickoff)) {
      result.rejected.push(`${label}: not a Saturday game`);
      continue;
    }

    // Ask the same function that assigns every other game its week. A fixed
    // day window around the week's nominal start would reject the Super Bowl,
    // which sits two weeks out because of the bye before it.
    //
    // College gets a week of slack in either direction. Its Week 0 means sites
    // disagree with each other about which number a given Saturday carries,
    // and demanding an exact match once threw away every game of every pull.
    // The games are written to the week the admin asked for either way, so the
    // slack only decides what is accepted, never where it lands.
    const placed = weekForSport(kickoff, sport, seasonYear);
    const drift = Math.abs(placed.weekNumber - weekNumber);
    if (drift > (config.saturdayOnly ? 1 : 0)) {
      result.rejected.push(
        `${label}: kickoff ${kickoff.toISOString().slice(0, 10)} lands in week ` +
          `${placed.weekNumber}, not week ${weekNumber}`,
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
      homeRank: config.ranked ? readRank(row.home_rank) : null,
      awayRank: config.ranked ? readRank(row.away_rank) : null,
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
