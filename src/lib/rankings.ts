/**
 * Matching an AP Top 25 poll onto the team names the odds feed uses.
 *
 * The feed writes a school with its nickname attached -- "Ohio State Buckeyes",
 * "Texas A&M Aggies" -- while a poll writes the school alone. So a poll entry
 * matches a feed name when the feed name begins with it. Kept pure so the
 * matching can be tested without a network call.
 */

export type PollEntry = { rank: number; team: string };

/** Lowercase, strip punctuation, collapse spaces. "Texas A&M" -> "texas a m". */
export function normalizeSchool(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Reads a poll payload, dropping anything that is not a usable entry. */
export function readPoll(input: unknown): PollEntry[] {
  const payload = input as { rankings?: unknown };
  if (!Array.isArray(payload?.rankings)) return [];

  const entries: PollEntry[] = [];
  const taken = new Set<number>();

  for (const raw of payload.rankings) {
    const row = raw as Record<string, unknown>;
    const rank = Number(row.rank);
    const team = typeof row.team === "string" ? row.team.trim() : "";
    if (!Number.isInteger(rank) || rank < 1 || rank > 25) continue;
    if (team.length < 2 || team.length > 60) continue;
    if (taken.has(rank)) continue;
    taken.add(rank);
    entries.push({ rank, team });
  }
  return entries;
}

/**
 * Words that continue a school name rather than starting a nickname. Without
 * them, ranked Texas would claim Texas State and ranked Miami would claim
 * Miami (OH) -- a wrong ranking beside a game is worse than no ranking.
 */
const CONTINUES_A_NAME = new Set([
  "state", "tech", "a", "am", "southern", "northern", "eastern", "western",
  "central", "international", "atlantic", "pacific", "coastal", "christian",
  "fl", "oh", "st", "united",
]);

/**
 * The poll position for one feed team name, or null when it is unranked.
 *
 * The feed writes "<school> <nickname>", so a poll entry matches when the feed
 * name begins with it. Longer poll names are tried first, and a match is
 * refused when the word just past the school looks like part of a longer
 * school name.
 */
export function rankFor(feedName: string, poll: PollEntry[]): number | null {
  const target = normalizeSchool(feedName);
  const ordered = [...poll].sort(
    (a, b) => normalizeSchool(b.team).length - normalizeSchool(a.team).length,
  );

  for (const entry of ordered) {
    const school = normalizeSchool(entry.team);
    if (target === school) return entry.rank;
    if (!target.startsWith(`${school} `)) continue;
    const next = target.slice(school.length + 1).split(" ")[0];
    if (CONTINUES_A_NAME.has(next)) continue;
    return entry.rank;
  }
  return null;
}

/**
 * Reads a Top 25 pasted in from anywhere -- a poll page, a text message, a
 * screenshot's text. Formats in the wild all look like a number and a school,
 * so that is all this insists on:
 *
 *     1. Ohio State (12-0)      1 Ohio State      1) Ohio State 62
 *
 * Costs nothing and cannot hallucinate, which is the point: it is the free
 * alternative to asking a model to go and look.
 */
export function parsePastedPoll(text: string): PollEntry[] {
  const entries: PollEntry[] = [];
  const taken = new Set<number>();

  for (const line of text.split(/[\n\r]+/)) {
    const match = /^\s*(\d{1,2})\s*[.)\]:-]?\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const rank = Number(match[1]);
    if (!Number.isInteger(rank) || rank < 1 || rank > 25 || taken.has(rank)) continue;

    // Trailing records, vote counts and previous rankings are not the name.
    const team = match[2]
      .replace(/\([^)]*\)/g, " ")
      .replace(/\d+\s*-\s*\d+/g, " ")
      // Vote totals and previous rankings trail the name: strip them before
      // commas become spaces, or "Texas A&M 1,455" keeps the 1.
      .replace(/(?:[\s,;|(\[]*[\d,]+)+\s*$/, "")
      .replace(/[,;|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (team.length < 2 || team.length > 60) continue;

    taken.add(rank);
    entries.push({ rank, team });
  }

  return entries.sort((a, b) => a.rank - b.rank);
}
