/**
 * Matching an AP Top 25 poll onto the team names the odds feed uses.
 *
 * The feed writes a school with its nickname attached -- "Ohio State Buckeyes",
 * "Texas A&M Aggies" -- while a poll writes the school alone. So a poll entry
 * matches a feed name when the feed name begins with it. Kept pure so the
 * matching can be tested without a network call.
 */

export type PollEntry = {
  rank: number;
  team: string;
  /** Win-loss record as the poll prints it, e.g. "10-1". Absent if not shown. */
  record?: string;
};

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
    const record = typeof row.record === "string" ? row.record.trim() : "";
    entries.push(/^\d{1,2}-\d{1,2}$/.test(record) ? { rank, team, record } : { rank, team });
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
export function entryFor(feedName: string, poll: PollEntry[]): PollEntry | null {
  const target = normalizeSchool(feedName);
  const ordered = [...poll].sort(
    (a, b) => normalizeSchool(b.team).length - normalizeSchool(a.team).length,
  );

  for (const entry of ordered) {
    const school = normalizeSchool(entry.team);
    if (target === school) return entry;
    if (!target.startsWith(`${school} `)) continue;
    const next = target.slice(school.length + 1).split(" ")[0];
    if (CONTINUES_A_NAME.has(next)) continue;
    return entry;
  }
  return null;
}

/** Just the position, for callers that only want the number. */
export function rankFor(feedName: string, poll: PollEntry[]): number | null {
  return entryFor(feedName, poll)?.rank ?? null;
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
export function parsePastedPoll(
  text: string,
  options: { sequential?: boolean } = {},
): PollEntry[] {
  const entries: PollEntry[] = [];
  const taken = new Set<number>();

  for (const line of text.split(/[\n\r]+/)) {
    const match = /^\s*(\d{1,2})\s*[.)\]:-]?\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const rank = Number(match[1]);
    if (!Number.isInteger(rank) || rank < 1 || rank > 25) continue;
    // Reading a page, a stray number must not claim a rank and lock the real
    // row out of it -- the caller's sequence check decides what counts. In a
    // pasted poll there is no furniture, so the first line to claim a rank
    // keeps it.
    if (!options.sequential && taken.has(rank)) continue;

    // A record beside the name is worth keeping: it tells somebody who does
    // not follow college football whether this is a good team.
    const record = /\b(\d{1,2})\s*-\s*(\d{1,2})\b/.exec(match[2]);

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

    if (!options.sequential) taken.add(rank);
    entries.push(record ? { rank, team, record: `${record[1]}-${record[2]}` } : { rank, team });
  }

  // A page read top to bottom has to keep its order so the sequence check can
  // work; a pasted poll may arrive in any order, so it is sorted.
  return options.sequential ? entries : entries.sort((a, b) => a.rank - b.rank);
}

/**
 * Reads a Top 25 out of a web page.
 *
 * The markup of a rankings page is nobody's contract and will change, so this
 * does not depend on it: scripts and styles are dropped, every tag becomes a
 * space or a line break, and what is left is read as lines the same way a
 * pasted poll is.
 *
 * The one thing it insists on is a sequence. A page is full of stray numbers --
 * navigation, dates, scores -- so a line only counts when its number is the
 * next rank expected, starting at 1. A heading that happens to say "3" cannot
 * claim third place, because second place has not been seen yet.
 */
export function pollFromHtml(html: string): PollEntry[] {
  const text = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(tr|li|p|h[1-6]|div|section)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&[a-z]+;/gi, " ");

  const entries: PollEntry[] = [];
  let expected = 1;

  for (const entry of parsePastedPoll(text, { sequential: true })) {
    if (entry.rank !== expected) continue;
    entries.push(entry);
    expected += 1;
  }
  return entries;
}
