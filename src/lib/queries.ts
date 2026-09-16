import "server-only";
import { cache } from "react";
import { db, unwrap } from "./db";
import { generateJoinCode, hashPin, timingSafeEquals, verifyPin } from "./crypto";
import { env } from "./env";
import { weekLabel } from "./format";
import { buildStandings, type Adjustment, type ScoredPick, type Standing } from "./scoring";
import { SPORTS, type Sport } from "./sports";
import type { ProposedGame } from "./claude-odds-validate";
import {
  pollInForce,
  rankFor,
  weeksGovernedByPoll,
  type PollEntry,
} from "./rankings";
import {
  isGameOpen,
  type TotalSide,
  type AdminAction,
  type Game,
  type GameStatus,
  type GameCard,
  type Group,
  type Pick,
  type PointAdjustment,
  type Side,
  type User,
  type Week,
  type WeekState,
} from "./types";

export class AppError extends Error {}

// ------------------------------------------------------------------ groups

export async function createGroup(
  groupName: string,
  username: string,
  pin: string,
  ownerKey: string,
): Promise<{ group: Group; user: User }> {
  // Creating a pool is owner-only. Checked here rather than only in the form
  // action, so no future caller can skip it.
  const expected = env.createGroupSecret;
  if (!expected) {
    throw new AppError(
      "Creating a pool is switched off on this deployment. Set CREATE_GROUP_SECRET to enable it.",
    );
  }
  if (!timingSafeEquals(ownerKey, expected)) {
    throw new AppError("That owner key is not right.");
  }

  const group = await insertGroupWithUniqueCode(groupName.trim());
  const user = unwrap(
    await db()
      .from("users")
      .insert({
        group_id: group.id,
        username: username.trim(),
        pin_hash: hashPin(pin),
        is_admin: true,
      })
      .select("id, group_id, username, is_admin, created_at")
      .single(),
  ) as User;

  unwrap(
    await db()
      .from("groups")
      .update({ admin_user_id: user.id })
      .eq("id", group.id)
      .select("id")
      .single(),
  );

  return { group: { ...group, admin_user_id: user.id }, user };
}

/** Join codes are random, so a collision just means trying again. */
async function insertGroupWithUniqueCode(name: string): Promise<Group> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await db()
      .from("groups")
      .insert({ name, join_code: generateJoinCode() })
      .select("*")
      .single();
    if (!result.error) return result.data as Group;
    if (!isUniqueViolation(result.error)) throw new Error(result.error.message);
  }
  throw new AppError("Could not allocate a join code. Try again.");
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function getGroupOnce(groupId: string): Promise<Group | null> {
  const result = await db().from("groups").select("*").eq("id", groupId).maybeSingle();
  return unwrap(result) as Group | null;
}

async function getGroupByJoinCode(joinCode: string): Promise<Group | null> {
  const result = await db()
    .from("groups")
    .select("*")
    .eq("join_code", joinCode.trim().toUpperCase())
    .maybeSingle();
  return unwrap(result) as Group | null;
}

export async function regenerateJoinCode(groupId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const result = await db()
      .from("groups")
      .update({ join_code: code })
      .eq("id", groupId)
      .select("join_code")
      .single();
    if (!result.error) return code;
    if (!isUniqueViolation(result.error)) throw new Error(result.error.message);
  }
  throw new AppError("Could not allocate a join code. Try again.");
}

// ------------------------------------------------------------------- users

const USER_COLUMNS =
  "id, group_id, username, is_admin, created_at, display_name, email, avatar_url";

/** Roughly 45KB of image once base64 is decoded; matches the check constraint. */
const MAX_AVATAR_CHARS = 60_000;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Updates the viewer's own profile. The avatar must be an inline data URL:
 * a remote address would let whoever hosts it see every member who loads the
 * leaderboard, and the database refuses one anyway.
 */
export async function updateProfile(
  userId: string,
  input: { displayName: string | null; email: string | null; avatarUrl: string | null | undefined },
): Promise<void> {
  const patch: Record<string, string | null> = {
    display_name: input.displayName,
    email: input.email,
  };

  if (input.displayName !== null && input.displayName.length > 40) {
    throw new AppError("Keep the name to 40 characters or fewer.");
  }
  if (input.email !== null && !EMAIL_SHAPE.test(input.email)) {
    throw new AppError("That does not look like an email address.");
  }

  // undefined means "leave the picture alone"; null means "remove it".
  if (input.avatarUrl !== undefined) {
    if (input.avatarUrl !== null) {
      if (!input.avatarUrl.startsWith("data:image/")) {
        throw new AppError("That picture could not be read. Try another one.");
      }
      if (input.avatarUrl.length > MAX_AVATAR_CHARS) {
        throw new AppError("That picture is too large even after shrinking. Try another one.");
      }
    }
    patch.avatar_url = input.avatarUrl;
  }

  unwrap(await db().from("users").update(patch).eq("id", userId).select("id"));
}

export async function joinGroup(
  joinCode: string,
  username: string,
  pin: string,
): Promise<{ group: Group; user: User }> {
  const group = await getGroupByJoinCode(joinCode);
  if (!group) throw new AppError("That join code doesn't match any group.");

  const result = await db()
    .from("users")
    .insert({
      group_id: group.id,
      username: username.trim(),
      pin_hash: hashPin(pin),
      is_admin: false,
    })
    .select(USER_COLUMNS)
    .single();

  if (result.error) {
    if (isUniqueViolation(result.error)) {
      throw new AppError(
        `"${username.trim()}" is already taken in ${group.name}. Sign in instead, or pick another name.`,
      );
    }
    throw new Error(result.error.message);
  }

  return { group, user: result.data as User };
}

/** Returning members prove they own a username with the PIN they set at join. */
export async function signIn(
  joinCode: string,
  username: string,
  pin: string,
): Promise<{ group: Group; user: User }> {
  const group = await getGroupByJoinCode(joinCode);
  if (!group) throw new AppError("That join code doesn't match any group.");

  const row = unwrap(
    await db()
      .from("users")
      .select(`${USER_COLUMNS}, pin_hash`)
      .eq("group_id", group.id)
      .ilike("username", username.trim())
      .maybeSingle(),
  ) as (User & { pin_hash: string }) | null;

  if (!row || !verifyPin(pin, row.pin_hash)) {
    throw new AppError("That username and PIN don't match.");
  }

  const { pin_hash: _pinHash, ...user } = row;
  return { group, user };
}

async function getUserOnce(userId: string): Promise<User | null> {
  const result = await db().from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
  return unwrap(result) as User | null;
}

async function getMembersOnce(groupId: string): Promise<User[]> {
  const result = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("group_id", groupId)
    .order("username");
  return (unwrap(result) as User[]) ?? [];
}

/**
 * Promotes or demotes a member. The last admin cannot be demoted, since a
 * group with no admin has no way back -- nobody could regenerate the join code
 * or promote anyone.
 */
export async function setAdmin(
  groupId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    const admins = unwrap<{ id: string }[]>(
      await db().from("users").select("id").eq("group_id", groupId).eq("is_admin", true),
    ) ?? [];
    const remaining = admins.filter((admin) => admin.id !== userId);
    if (remaining.length === 0) {
      throw new AppError(
        "That is the only admin left. Promote someone else first, then remove this one.",
      );
    }
  }

  unwrap(
    await db()
      .from("users")
      .update({ is_admin: isAdmin })
      .eq("id", userId)
      .eq("group_id", groupId)
      .select("id"),
  );
}

export async function removeUser(groupId: string, userId: string): Promise<void> {
  unwrap(await db().from("users").delete().eq("id", userId).eq("group_id", groupId).select("id"));
}

// ------------------------------------------------------------------- weeks

const WEEK_COLUMNS =
  "id, season_year, week_number, season_type, label, sport, opened_at, closed_at, hidden_at";

async function listWeeksOnce(sport?: Sport): Promise<Week[]> {
  let query = db()
    .from("weeks")
    .select(WEEK_COLUMNS)
    .order("sport")
    .order("season_year")
    .order("week_number");
  if (sport) query = query.eq("sport", sport);
  return ((unwrap(await query) as Week[]) ?? []);
}

/**
 * The weeks members can see. A week appears only once its lines have been
 * pulled, so next week's games never show up early.
 */
async function listOpenedWeeksOnce(sport?: Sport): Promise<Week[]> {
  let query = db()
    .from("weeks")
    .select(WEEK_COLUMNS)
    .not("opened_at", "is", null)
    .is("hidden_at", null)
    .order("season_year")
    .order("week_number");
  if (sport) query = query.eq("sport", sport);
  return (unwrap(await query) as Week[]) ?? [];
}

/**
 * The weeks members actually see: opened, and not yet closed.
 *
 * Closing a week takes it off the app entirely. Its points stay in the season
 * totals on the leaderboard, which reads the full opened list, but its games
 * and picks are no longer browsable.
 */
async function listPickableWeeksOnce(sport?: Sport): Promise<Week[]> {
  let query = db()
    .from("weeks")
    .select(WEEK_COLUMNS)
    .not("opened_at", "is", null)
    .is("closed_at", null)
    .is("hidden_at", null)
    .order("season_year")
    .order("week_number");
  if (sport) query = query.eq("sport", sport);
  return (unwrap(await query) as Week[]) ?? [];
}

/**
 * Every week a member may look at: the open ones, and the finished ones.
 *
 * A closed week is read-only rather than gone. Closing it fixes the result;
 * it does not mean nobody may see how the week went, which is most of what a
 * pool talks about afterwards. Only an unpulled week is invisible, because
 * that one genuinely does not exist yet.
 */
async function listViewableWeeksOnce(sport?: Sport): Promise<Week[]> {
  let query = db()
    .from("weeks")
    .select(WEEK_COLUMNS)
    .not("opened_at", "is", null)
    .is("hidden_at", null)
    .order("season_year")
    .order("week_number");
  if (sport) query = query.eq("sport", sport);
  return (unwrap(await query) as Week[]) ?? [];
}

/** Which sports currently have a week that still accepts picks. */
async function sportsWithOpenWeeksOnce(): Promise<Sport[]> {
  const weeks = await listPickableWeeks();
  return SPORTS.filter((sport) => weeks.some((week) => week.sport === sport));
}

/**
 * Which sports have anything to look at, finished weeks included. A season
 * whose last week has been closed should not vanish from the app the moment
 * it ends; that is exactly when people want to read it.
 */
async function sportsWithViewableWeeksOnce(): Promise<Sport[]> {
  const weeks = await listViewableWeeks();
  return SPORTS.filter((sport) => weeks.some((week) => week.sport === sport));
}

/** Marks a week as visible. Called the first time lines land in it. */
async function openWeek(weekId: string): Promise<void> {
  unwrap(
    await db()
      .from("weeks")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", weekId)
      .is("opened_at", null)
      .select("id"),
  );
}

/** Closes a week for good, or reopens one closed by mistake. */
/**
 * Moves a week between its three states.
 *
 * Open takes picks. Closed is finished and still readable. Hidden is off the
 * app: no tab, no games, no column on the leaderboard, and its points count for
 * nobody. All three are reversible -- an admin sees every week whatever its
 * state -- so hiding is never the same as deleting.
 */
export async function setWeekState(weekId: string, state: WeekState): Promise<void> {
  const now = new Date().toISOString();
  unwrap(
    await db()
      .from("weeks")
      .update({
        // A hidden week keeps a closed stamp so unhiding puts it back where it
        // was rather than reopening it for picks by surprise.
        closed_at: state === "open" ? null : now,
        hidden_at: state === "hidden" ? now : null,
      })
      .eq("id", weekId)
      .select("id"),
  );
}

async function assertWeekOpen(weekId: string): Promise<Week> {
  const week = await getWeek(weekId);
  if (!week) throw new AppError("That week no longer exists.");
  if (week.closed_at) {
    throw new AppError(`${week.label} is closed. Reopen it first if you need to change something.`);
  }
  return week;
}

export async function getWeek(weekId: string): Promise<Week | null> {
  const result = await db().from("weeks").select(WEEK_COLUMNS).eq("id", weekId).maybeSingle();
  return unwrap(result) as Week | null;
}

export async function ensureWeek(
  seasonYear: number,
  weekNumber: number,
  sport: Sport = "nfl",
): Promise<Week> {
  const existing = unwrap(
    await db()
      .from("weeks")
      .select(WEEK_COLUMNS)
      .eq("sport", sport)
      .eq("season_year", seasonYear)
      .eq("week_number", weekNumber)
      .maybeSingle(),
  ) as Week | null;
  if (existing) return existing;

  // College has no postseason weeks in this app, and its weeks are plain
  // numbers rather than named rounds.
  const seasonType = sport === "nfl" && weekNumber > 18 ? "postseason" : "regular";
  const result = await db()
    .from("weeks")
    .insert({
      sport,
      season_year: seasonYear,
      week_number: weekNumber,
      season_type: seasonType,
      label: sport === "ncaaf" ? `Week ${weekNumber}` : weekLabel(weekNumber, seasonType),
    })
    .select(WEEK_COLUMNS)
    .single();

  if (result.error) {
    // Another request created it between the read and the write.
    if (isUniqueViolation(result.error)) return ensureWeek(seasonYear, weekNumber, sport);
    throw new Error(result.error.message);
  }
  return result.data as Week;
}

/**
 * The week to show by default: the earliest open week that still has a game to
 * come, otherwise the most recently opened one.
 *
 * Only ever returns a week members may see. Null means there is nothing open,
 * which the picks page reports rather than falling back to a closed week.
 */
export async function getCurrentWeek(sport?: Sport): Promise<Week | null> {
  const candidates = await listPickableWeeks(sport);
  if (candidates.length === 0) return null;

  const openedIds = new Set(candidates.map((week) => week.id));
  const upcoming =
    unwrap<{ week_id: string }[]>(
      await db()
        .from("games")
        .select("week_id, kickoff_time")
        .is("excluded_at", null)
        .gt("kickoff_time", new Date().toISOString())
        .order("kickoff_time")
        .limit(20),
    ) ?? [];

  const next = upcoming.find((game) => openedIds.has(game.week_id));
  if (next) return candidates.find((week) => week.id === next.week_id) ?? null;

  return candidates.at(-1) ?? null;
}

// ------------------------------------------------------------- rate limit

/**
 * Takes the right to do something at most once every `everyMs`, across every
 * request and every viewer.
 *
 * Returns true to exactly one caller per window. The claim is the update
 * itself -- `where updated_at < cutoff` -- so two page loads landing in the
 * same second cannot both win it, which is the whole point: without this, ten
 * people opening the picks page during a game would mean ten API calls.
 */
export async function claimSlot(key: string, everyMs: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = new Date(now - everyMs).toISOString();

  // Make sure the row is there. A duplicate means another request just did it.
  const seed = await db()
    .from("app_state")
    .insert({ key, updated_at: new Date(0).toISOString() })
    .select("key");
  if (seed.error && !isUniqueViolation(seed.error)) throw new Error(seed.error.message);

  const claim = await db()
    .from("app_state")
    .update({ updated_at: new Date(now).toISOString() })
    .eq("key", key)
    .lt("updated_at", cutoff)
    .select("key");
  if (claim.error) throw new Error(claim.error.message);
  return (claim.data?.length ?? 0) > 0;
}

/** Stores a small named value, for something a page needs without fetching it. */
export async function recordValue(key: string, value: unknown): Promise<void> {
  unwrap(
    await db()
      .from("app_state")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      )
      .select("key"),
  );
}

/** Reads one back, or null when it was never written. */
export async function readValue<T>(key: string): Promise<T | null> {
  const row = unwrap<{ value: T } | null>(
    await db().from("app_state").select("value").eq("key", key).maybeSingle(),
  );
  return row?.value ?? null;
}

/** When the named thing last ran, or null if it never has. */
export async function slotLastRun(key: string): Promise<Date | null> {
  const row = unwrap<{ updated_at: string } | null>(
    await db().from("app_state").select("updated_at").eq("key", key).maybeSingle(),
  );
  if (!row) return null;
  const at = new Date(row.updated_at);
  return at.getTime() === 0 ? null : at;
}

// ------------------------------------------------------------------- poll

/**
 * The poll that governs a week: its own, or the most recent one before it.
 *
 * A poll stands until the next is published, so a week without one of its own
 * is not unranked -- it is running on the last poll. Returns the week the poll
 * was filed against too, so a pull can say which it used.
 */
export async function getPollInForce(
  seasonYear: number,
  weekNumber: number,
): Promise<{ entries: PollEntry[]; weekNumber: number; source: string } | null> {
  const rows =
    unwrap<{ week_number: number; entries: PollEntry[]; source: string }[]>(
      await db()
        .from("ap_poll")
        .select("week_number, entries, source")
        .eq("season_year", seasonYear),
    ) ?? [];

  const usable = rows
    .filter((row) => Array.isArray(row.entries) && row.entries.length > 0)
    .map((row) => ({
      entries: row.entries,
      weekNumber: row.week_number,
      source: row.source,
    }));

  return pollInForce(usable, weekNumber);
}

/**
 * Every stored poll, so the admin page can say which weeks have one. The table
 * holds a row per week of a season, so reading it whole costs nothing.
 */
export async function listStoredPolls(): Promise<
  { seasonYear: number; weekNumber: number; ranked: number; source: string }[]
> {
  const rows =
    unwrap<{ season_year: number; week_number: number; entries: PollEntry[]; source: string }[]>(
      await db().from("ap_poll").select("season_year, week_number, entries, source"),
    ) ?? [];

  return rows.map((row) => ({
    seasonYear: row.season_year,
    weekNumber: row.week_number,
    ranked: Array.isArray(row.entries) ? row.entries.length : 0,
    source: row.source,
  }));
}

export async function savePoll(
  seasonYear: number,
  weekNumber: number,
  entries: PollEntry[],
  source: string,
): Promise<void> {
  if (entries.length === 0) throw new AppError("That poll had no ranked teams in it.");
  unwrap(
    await db()
      .from("ap_poll")
      .upsert(
        {
          season_year: seasonYear,
          week_number: weekNumber,
          entries,
          source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "season_year,week_number" },
      )
      .select("season_year"),
  );
}

/**
 * Puts a poll onto the games it governs.
 *
 * Rankings used to be written only while a pull was running, from a poll
 * stored beforehand, so the obvious order -- pull the games, then go and get
 * the poll -- left every game unranked with a re-pull as the only cure.
 * Saving a poll now fills in the slates it belongs to, whenever it is saved.
 *
 * It fills in every week the poll governs, not only the one it is filed
 * against. A poll stands until the next is published, so a Top 25 filed for
 * week 2 is week 3's poll as well until a week 3 poll exists -- and writing
 * only to week 2 was why a later week kept coming back unranked.
 *
 * Frozen games are left alone: their ranking is part of the week as it was
 * played.
 */
export async function applyPollToGames(
  seasonYear: number,
  weekNumber: number,
  entries: PollEntry[],
): Promise<{ ranked: number; games: number; weeks: number[] }> {
  const weeks = await weeksGovernedBy(seasonYear, weekNumber);
  if (weeks.length === 0) return { ranked: 0, games: 0, weeks: [] };

  let ranked = 0;
  const touched: number[] = [];
  const writes: { id: string; home: number | null; away: number | null }[] = [];

  for (const week of weeks) {
    const games = await getGamesForWeek(week.id);
    let here = 0;

    for (const game of games) {
      if (game.spread_frozen_at) continue;
      const home = rankFor(game.home_team, entries);
      const away = rankFor(game.away_team, entries);
      if (home !== null || away !== null) here += 1;
      if (home === game.home_rank && away === game.away_rank) continue;
      writes.push({ id: game.id, home, away });
    }

    ranked += here;
    if (here > 0) touched.push(week.weekNumber);
  }

  const results = await Promise.all(
    writes.map((write) =>
      db()
        .from("games")
        .update({ home_rank: write.home, away_rank: write.away })
        .eq("id", write.id)
        .is("spread_frozen_at", null)
        .select("id"),
    ),
  );

  const changed = results.filter(
    (result) => !result.error && (result.data?.length ?? 0) > 0,
  ).length;

  return { ranked, games: changed, weeks: touched.sort((a, b) => a - b) };
}

/**
 * The college weeks a poll rules over: its own, and every later week with no
 * poll of its own yet.
 */
async function weeksGovernedBy(
  seasonYear: number,
  weekNumber: number,
): Promise<{ id: string; weekNumber: number }[]> {
  const weeks =
    unwrap<{ id: string; week_number: number }[]>(
      await db()
        .from("weeks")
        .select("id, week_number")
        .eq("sport", "ncaaf")
        .eq("season_year", seasonYear),
    ) ?? [];

  const filed = (await listStoredPolls())
    .filter((poll) => poll.seasonYear === seasonYear && poll.ranked > 0)
    .map((poll) => poll.weekNumber);

  return weeksGovernedByPoll(
    weeks.map((week) => ({ id: week.id, weekNumber: week.week_number })),
    filed,
    weekNumber,
  );
}

/**
 * What the rankings for a week actually look like, name by name.
 *
 * Rankings going missing is always one of three things -- no poll stored, a
 * poll filed against the wrong week, or a school the feed spells differently --
 * and they are indistinguishable from the outside. This reports all three at
 * once so the admin page can say which it is instead of guessing.
 */
export async function inspectRankings(
  seasonYear: number,
  weekNumber: number,
): Promise<{
  poll: { weekNumber: number; source: string; ranked: number } | null;
  games: number;
  matched: number;
  unmatchedTeams: string[];
  unmatchedSchools: string[];
}> {
  const poll = await getPollInForce(seasonYear, weekNumber);
  const week = unwrap<{ id: string } | null>(
    await db()
      .from("weeks")
      .select("id")
      .eq("sport", "ncaaf")
      .eq("season_year", seasonYear)
      .eq("week_number", weekNumber)
      .maybeSingle(),
  );

  const games = week ? await getGamesForWeek(week.id) : [];
  const entries = poll?.entries ?? [];

  const names = new Set<string>();
  for (const game of games) {
    names.add(game.home_team);
    names.add(game.away_team);
  }

  const unmatchedTeams: string[] = [];
  const claimed = new Set<number>();
  for (const name of names) {
    const rank = rankFor(name, entries);
    if (rank === null) unmatchedTeams.push(name);
    else claimed.add(rank);
  }

  const matched = games.filter(
    (game) =>
      rankFor(game.home_team, entries) !== null ||
      rankFor(game.away_team, entries) !== null,
  ).length;

  return {
    poll: poll
      ? { weekNumber: poll.weekNumber, source: poll.source, ranked: entries.length }
      : null,
    games: games.length,
    matched,
    unmatchedTeams: unmatchedTeams.sort(),
    unmatchedSchools: entries
      .filter((entry) => !claimed.has(entry.rank))
      .map((entry) => `${entry.rank} ${entry.team}`),
  };
}

// ------------------------------------------------------------------- games

const GAME_COLUMNS =
  "id, week_id, home_team, away_team, kickoff_time, home_spread, spread_source, " +
  "spread_updated_at, spread_frozen_at, frozen_home_spread, final_home_score, " +
  "final_away_score, score_overridden_at, status, odds_api_event_id, spread_locked_at, " +
  "kickoff_changed_at, last_seen_in_feed_at, home_rank, away_rank, " +
  "total_points, frozen_total, totals_enabled, excluded_at";

/**
 * A week's games. Admins ask for all of them; members only ever see the ones
 * in the slate, which is what `inSlateOnly` is for.
 */
export async function getGamesForWeek(
  weekId: string,
  inSlateOnly = false,
): Promise<Game[]> {
  let query = db().from("games").select(GAME_COLUMNS).eq("week_id", weekId);
  if (inSlateOnly) query = query.is("excluded_at", null);
  const result = await query.order("kickoff_time").order("home_team");
  return (unwrap(result) as Game[]) ?? [];
}

/**
 * Takes a game out of the week's slate, or puts it back.
 *
 * A college pull returns twenty games so there is something to choose from,
 * and ten or so is a week worth picking. Setting one aside is not deleting it:
 * the game stays, and can come back.
 *
 * Refused once anyone has picked it. Excluding a picked game would either
 * quietly void a pick or quietly keep scoring an invisible one, and neither is
 * something to do behind a member's back. Delete the game if you truly mean to
 * take the picks with it.
 */
export async function setGameInSlate(gameId: string, inSlate: boolean): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);

  if (!inSlate) {
    if (game.spread_frozen_at || !isGameOpen(game)) {
      throw new AppError("That game has already started, so it stays in the slate.");
    }
    const picked = await db()
      .from("picks")
      .select("id", { head: true, count: "exact" })
      .eq("game_id", gameId);
    if (picked.error) throw new Error(picked.error.message);
    if ((picked.count ?? 0) > 0) {
      throw new AppError(
        `${picked.count} pick${picked.count === 1 ? " has" : "s have"} already been made on ` +
          "this game, so it cannot leave the slate. Delete the game if you mean to take " +
          "those picks with it.",
      );
    }
  }

  unwrap(
    await db()
      .from("games")
      .update({ excluded_at: inSlate ? null : new Date().toISOString() })
      .eq("id", gameId)
      .select("id"),
  );
}

export async function getGame(gameId: string): Promise<Game | null> {
  const result = await db().from("games").select(GAME_COLUMNS).eq("id", gameId).maybeSingle();
  return unwrap(result) as Game | null;
}

export async function createGame(input: {
  weekId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  homeSpread: number | null;
}): Promise<Game> {
  await assertWeekOpen(input.weekId);
  await openWeek(input.weekId);

  const result = unwrap(
    await db()
      .from("games")
      .insert({
        week_id: input.weekId,
        home_team: input.homeTeam,
        away_team: input.awayTeam,
        kickoff_time: input.kickoffTime,
        home_spread: input.homeSpread,
        spread_source: input.homeSpread === null ? null : "manual",
        spread_updated_at: input.homeSpread === null ? null : new Date().toISOString(),
      })
      .select(GAME_COLUMNS)
      .single(),
  );
  return result as Game;
}

/**
 * Writes a pulled slate into a week, locking each line.
 *
 * A locked line is skipped by the odds feed but can be replaced by a later
 * deliberate pull, so re-pulling a week updates the numbers rather than
 * duplicating the games. Kickoff still freezes a line permanently, and a
 * frozen game is left alone here -- re-pulling cannot move a number that
 * picks were already graded against.
 */
export async function applyLockedLines(
  weekId: string,
  games: ProposedGame[],
  source: string,
): Promise<{
  inserted: number;
  updated: number;
  skippedFrozen: number;
  movedKickoff: string[];
  /** Games in this week the pull did not mention -- dropped off the slate. */
  missing: string[];
}> {
  await assertWeekOpen(weekId);
  await openWeek(weekId);

  const existing = await getGamesForWeek(weekId);
  const byMatchup = new Map(
    existing.map((game) => [`${game.away_team}@${game.home_team}`, game]),
  );

  const now = new Date().toISOString();
  const counts = {
    inserted: 0,
    updated: 0,
    skippedFrozen: 0,
    movedKickoff: [] as string[],
    missing: [] as string[],
  };
  const seen = new Set<string>();

  // Decide everything first, write afterwards. A twenty game slate was making
  // forty round trips one after another, each waiting on the last, which is
  // most of a minute on a bad connection and the sort of thing that outlasts a
  // serverless function.
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];

  for (const game of games) {
    const match = byMatchup.get(`${game.awayTeam}@${game.homeTeam}`);

    if (!match) {
      inserts.push({
        week_id: weekId,
        home_team: game.homeTeam,
        away_team: game.awayTeam,
        kickoff_time: game.kickoffIso,
        home_spread: game.homeSpread,
        spread_source: source,
        spread_updated_at: now,
        spread_locked_at: now,
        last_seen_in_feed_at: now,
        home_rank: game.homeRank,
        away_rank: game.awayRank,
      });
      continue;
    }

    // Frozen, already under way, or already resolved: leave it alone. Only
    // spread_frozen_at is set by the scheduled freeze, so a game that reached
    // kickoff before any run happened would otherwise have its line and
    // kickoff rewritten by a re-pull.
    if (
      match.spread_frozen_at ||
      match.status !== "scheduled" ||
      new Date(match.kickoff_time).getTime() <= Date.now()
    ) {
      counts.skippedFrozen += 1;
      continue;
    }

    seen.add(match.id);
    const timeMoved = match.kickoff_time !== game.kickoffIso;
    if (timeMoved) counts.movedKickoff.push(`${game.awayTeam} at ${game.homeTeam}`);

    updates.push({
      id: match.id,
      patch: {
        home_spread: game.homeSpread,
        kickoff_time: game.kickoffIso,
        spread_source: source,
        spread_updated_at: now,
        spread_locked_at: now,
        last_seen_in_feed_at: now,
        home_rank: game.homeRank,
        away_rank: game.awayRank,
        ...(timeMoved ? { kickoff_changed_at: now } : {}),
      },
    });
  }

  // Every new game in one statement.
  if (inserts.length > 0) {
    const bulk = await db().from("games").insert(inserts).select("id");
    if (bulk.error) {
      // One bad row rejects the whole statement, so fall back to inserting
      // them singly and keep whatever is good.
      for (const row of inserts) {
        const one = await db().from("games").insert(row).select("id");
        if (!one.error) counts.inserted += 1;
      }
    } else {
      counts.inserted = bulk.data?.length ?? inserts.length;
    }
  }

  // The updates stay one statement each, because each carries the guard that
  // refuses to touch a line frozen since this run started reading. They go out
  // together rather than in single file, which is where the time went.
  const results = await Promise.all(
    updates.map((update) =>
      db()
        .from("games")
        .update(update.patch)
        .eq("id", update.id)
        .is("spread_frozen_at", null)
        .select("id"),
    ),
  );
  for (const result of results) {
    if (!result.error && result.data && result.data.length > 0) counts.updated += 1;
  }

  // Anything already in the week that this pull never mentioned has come off
  // the slate. The game is left alone -- deleting it would take every pick on
  // it -- but it is named so an admin can decide.
  for (const existingGame of existing) {
    if (seen.has(existingGame.id)) continue;
    if (existingGame.spread_frozen_at) continue;
    counts.missing.push(`${existingGame.away_team} at ${existingGame.home_team}`);
  }

  return counts;
}

/**
 * Sets the over/under number for a game, and turns the market on.
 *
 * Passing null takes the market off the game entirely and drops the number
 * with it.
 */
export async function setGameTotal(
  gameId: string,
  total: number | null,
): Promise<void> {
  const game = await editableGame(gameId);
  if (total !== null && (!Number.isFinite(total) || total <= 0 || total > 150)) {
    throw new AppError("Enter a total between 0 and 150.");
  }

  unwrap(
    await db()
      .from("games")
      .update({ total_points: total, totals_enabled: total !== null })
      .eq("id", game.id)
      .is("spread_frozen_at", null)
      .select("id"),
  );
}

/**
 * Flags a game as one that should carry an over/under, without a number.
 *
 * This is what the toggle does. The number arrives later, from a totals pull,
 * which is the whole point: an admin marks the games worth an over/under and
 * then fetches every number in one request.
 */
export async function setTotalsEnabled(gameId: string, enabled: boolean): Promise<void> {
  const game = await editableGame(gameId);
  unwrap(
    await db()
      .from("games")
      .update(
        enabled
          ? { totals_enabled: true }
          : { totals_enabled: false, total_points: null },
      )
      .eq("id", game.id)
      .is("spread_frozen_at", null)
      .select("id"),
  );
}

/**
 * Writes pulled over/under numbers onto the games flagged for them.
 *
 * Only flagged games are touched: the feed carries a total for nearly every
 * game, and turning the market on for a game nobody asked for would put a
 * second pick in front of members without anyone deciding to.
 */
export async function applyTotals(
  weekId: string,
  totals: { awayTeam: string; homeTeam: string; total: number }[],
): Promise<{ filled: number; unchanged: number; waiting: string[] }> {
  await assertWeekOpen(weekId);

  const byMatchup = new Map(
    totals.map((entry) => [`${entry.awayTeam}@${entry.homeTeam}`, entry.total]),
  );
  const counts = { filled: 0, unchanged: 0, waiting: [] as string[] };
  const writes: { id: string; total: number }[] = [];

  for (const game of await getGamesForWeek(weekId)) {
    if (!game.totals_enabled || game.spread_frozen_at || game.excluded_at) continue;

    const found = byMatchup.get(`${game.away_team}@${game.home_team}`);
    if (found === undefined) {
      counts.waiting.push(`${game.away_team} at ${game.home_team}`);
    } else if (game.total_points !== null && Number(game.total_points) === found) {
      counts.unchanged += 1;
    } else {
      writes.push({ id: game.id, total: found });
    }
  }

  const results = await Promise.all(
    writes.map((write) =>
      db()
        .from("games")
        .update({ total_points: write.total })
        .eq("id", write.id)
        .is("spread_frozen_at", null)
        .select("id"),
    ),
  );
  for (const result of results) {
    if (!result.error && result.data && result.data.length > 0) counts.filled += 1;
  }

  return counts;
}

/** Shared checks: the game exists, its week is open, and it has not kicked off. */
async function editableGame(gameId: string) {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);
  if (game.spread_frozen_at) {
    throw new AppError("This game has already kicked off, so its total is fixed.");
  }
  return game;
}

/**
 * Writes scores read off a scoreboard page.
 *
 * A game an admin corrected by hand is left alone, exactly as the feed leaves
 * it: a correction outranks anything automatic. A game whose score already
 * matches is skipped rather than rewritten.
 */
export async function applyScrapedScores(
  weekId: string,
  scores: { gameId: string; home: number; away: number; final: boolean }[],
): Promise<{ updated: number; unchanged: number }> {
  await assertWeekOpen(weekId);

  const games = new Map((await getGamesForWeek(weekId)).map((game) => [game.id, game]));
  const counts = { updated: 0, unchanged: 0 };
  const writes: { id: string; home: number; away: number; status: GameStatus }[] = [];

  for (const score of scores) {
    const game = games.get(score.gameId);
    if (!game || game.score_overridden_at) continue;

    const status: GameStatus = score.final ? "final" : "live";
    if (
      game.final_home_score === score.home &&
      game.final_away_score === score.away &&
      game.status === status
    ) {
      counts.unchanged += 1;
      continue;
    }
    writes.push({ id: game.id, home: score.home, away: score.away, status });
  }

  const results = await Promise.all(
    writes.map((write) =>
      db()
        .from("games")
        .update({
          final_home_score: write.home,
          final_away_score: write.away,
          status: write.status,
        })
        .eq("id", write.id)
        .is("score_overridden_at", null)
        .select("id"),
    ),
  );
  for (const result of results) {
    if (!result.error && result.data && result.data.length > 0) counts.updated += 1;
  }

  return counts;
}

/** Saves or changes an over/under pick. */
export async function saveTotalPick(
  userId: string,
  gameId: string,
  side: TotalSide,
): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);
  if (!game.totals_enabled) throw new AppError("This game has no over/under.");
  if (game.total_points === null) {
    throw new AppError("This game's over/under has not been pulled yet.");
  }
  if (!isGameOpen(game)) throw new AppError("That game has already started.");

  const result = await db()
    .from("picks")
    .upsert(
      {
        user_id: userId,
        game_id: gameId,
        week_id: game.week_id,
        picked_side: side,
        market: "total",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,game_id,market" },
    )
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
}

export async function deleteGame(gameId: string): Promise<void> {
  unwrap(await db().from("games").delete().eq("id", gameId).select("id"));
}

// ------------------------------------------------------------------- picks

const PICK_COLUMNS =
  "id, user_id, game_id, week_id, picked_side, market, is_lock, locked_at, points_awarded";

export async function getPicksForWeek(weekId: string, userIds: string[]): Promise<Pick[]> {
  if (userIds.length === 0) return [];
  const result = await db()
    .from("picks")
    .select(PICK_COLUMNS)
    .eq("week_id", weekId)
    .in("user_id", userIds);
  return (unwrap(result) as Pick[]) ?? [];
}

/**
 * The week's board for one viewer: every game, their own pick, whether the
 * game still accepts changes, and -- only for games already under way --
 * what everyone else picked.
 */
export async function getWeekBoard(
  groupId: string,
  userId: string,
  weekId: string,
): Promise<GameCard[]> {
  const [games, members] = await Promise.all([
    getGamesForWeek(weekId, true),
    getMembers(groupId),
  ]);
  const memberIds = members.map((member) => member.id);
  const allPicks = await getPicksForWeek(weekId, memberIds);

  const usernames = new Map(members.map((member) => [member.id, member.username]));

  // Spread and total picks live in the same table; the board keeps them apart
  // so everything downstream can assume a pick means a side.
  const byGame = new Map<string, Pick[]>();
  const totalsByGame = new Map<string, Pick[]>();
  for (const pick of allPicks) {
    const target = pick.market === "total" ? totalsByGame : byGame;
    const list = target.get(pick.game_id);
    if (list) list.push(pick);
    else target.set(pick.game_id, [pick]);
  }

  const now = new Date();
  return games.map((game) => {
    const picks = byGame.get(game.id) ?? [];
    const open = isGameOpen(game, now);
    const kickedOff = new Date(game.kickoff_time).getTime() <= now.getTime();

    return {
      game,
      pick: picks.find((pick) => pick.user_id === userId) ?? null,
      totalPick:
        (totalsByGame.get(game.id) ?? []).find((pick) => pick.user_id === userId) ?? null,
      isOpen: open,
      // Counts every member's pick, the viewer's included, so the percentage
      // describes the whole group rather than everyone else.
      consensus: kickedOff
        ? {
            total: picks.length,
            home: picks.filter((pick) => pick.picked_side === "home").length,
            away: picks.filter((pick) => pick.picked_side === "away").length,
          }
        : null,
      // Picks stay hidden until each game kicks off, so nobody can copy.
      revealed: kickedOff
        ? picks
            .filter((pick) => pick.user_id !== userId)
            .map((pick) => ({
              username: usernames.get(pick.user_id) ?? "?",
              side: pick.picked_side as Side,
              isLock: pick.is_lock,
            }))
            .sort((a, b) => a.username.localeCompare(b.username))
        : null,
    };
  });
}

/** Saves or changes a pick. Rejected once the game itself has kicked off. */
export async function savePick(
  userId: string,
  gameId: string,
  side: Side,
): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);
  if (!isGameOpen(game)) throw new AppError("That game has already started.");

  const result = await db()
    .from("picks")
    .upsert(
      {
        user_id: userId,
        game_id: gameId,
        week_id: game.week_id,
        picked_side: side,
        market: "spread",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,game_id,market" },
    )
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
}

/**
 * Moves the week's lock onto one game. The previous lock is cleared first,
 * which fails if that game has already started -- a lock is frozen with its
 * game, so the week's lock cannot be moved off a game already under way.
 */
export async function setLock(userId: string, gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);
  if (!isGameOpen(game)) throw new AppError("That game has already started.");

  const existing = unwrap(
    await db()
      .from("picks")
      .select(`${PICK_COLUMNS}, games!inner(kickoff_time, status)`)
      .eq("user_id", userId)
      .eq("week_id", game.week_id)
      .eq("is_lock", true)
      .maybeSingle(),
  ) as (Pick & { games: { kickoff_time: string; status: string } }) | null;

  if (existing && existing.game_id !== gameId) {
    if (new Date(existing.games.kickoff_time).getTime() <= Date.now()) {
      throw new AppError(
        "Your lock is on a game that already started, so it can't be moved this week.",
      );
    }
    unwrap(
      await db().from("picks").update({ is_lock: false }).eq("id", existing.id).select("id"),
    );
  }

  // Locking must not disturb a side already chosen, so an existing pick is
  // updated in place; only a brand new pick needs a default side.
  const current = unwrap<{ id: string } | null>(
    await db()
      .from("picks")
      .select("id")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("market", "spread")
      .maybeSingle(),
  );

  const result = current
    ? await db()
        .from("picks")
        .update({ is_lock: true, updated_at: new Date().toISOString() })
        .eq("id", current.id)
        .select("id")
        .single()
    : await db()
        .from("picks")
        .insert({
          user_id: userId,
          game_id: gameId,
          week_id: game.week_id,
          picked_side: "home",
          market: "spread",
          is_lock: true,
        })
        .select("id")
        .single();
  if (result.error) throw new Error(result.error.message);
}

export async function clearLock(userId: string, gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");
  await assertWeekOpen(game.week_id);
  if (!isGameOpen(game)) throw new AppError("That game has already started.");
  unwrap(
    await db()
      .from("picks")
      .update({ is_lock: false })
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("market", "spread")
      .select("id"),
  );
}

// -------------------------------------------------------------- leaderboard

export async function getStandings(groupId: string): Promise<{
  standings: Standing[];
  members: User[];
  weeks: Week[];
}> {
  const members = await getMembers(groupId);
  const memberIds = members.map((member) => member.id);
  if (memberIds.length === 0) return { standings: [], members, weeks: [] };

  const [pickRows, adjustmentRows, weeks] = await Promise.all([
    db()
      .from("picks")
      .select("user_id, week_id, is_lock, points_awarded")
      .in("user_id", memberIds),
    db().from("point_adjustments").select("user_id, week_id, points").eq("group_id", groupId),
    listOpenedWeeks(),
  ]);

  // listOpenedWeeks leaves out hidden weeks, and a hidden week counts for
  // nobody: neither its picks nor an adjustment written against it.
  const visible = new Set(weeks.map((week) => week.id));
  const picks = (unwrap<PickWithGame[]>(pickRows) ?? [])
    .filter((row) => visible.has(row.week_id))
    .map(toScoredPick);
  const adjustmentRowsTyped =
    unwrap<{ user_id: string; week_id: string | null; points: number }[]>(adjustmentRows) ?? [];
  const adjustments: Adjustment[] = adjustmentRowsTyped
    .filter((row) => row.week_id === null || visible.has(row.week_id))
    .map((row) => ({
      userId: row.user_id,
      weekId: row.week_id,
      points: Number(row.points),
    }));

  return { standings: buildStandings(memberIds, picks, adjustments), members, weeks };
}

type PickWithGame = {
  user_id: string;
  week_id: string;
  is_lock: boolean;
  points_awarded: number | null;
};

function toScoredPick(row: PickWithGame): ScoredPick {
  const points = row.points_awarded === null ? null : Number(row.points_awarded);
  return {
    userId: row.user_id,
    weekId: row.week_id,
    points,
    isLock: row.is_lock,
    result: points === null ? null : points > 0 ? "win" : null,
  };
}

// -------------------------------------------------------------------- admin

export async function logAdminAction(input: {
  groupId: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  targetUserId?: string | null;
  gameId?: string | null;
  note?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  unwrap(
    await db()
      .from("admin_actions")
      .insert({
        group_id: input.groupId,
        actor_user_id: input.actorUserId,
        actor_username: input.actorUsername,
        action: input.action,
        target_user_id: input.targetUserId ?? null,
        game_id: input.gameId ?? null,
        note: input.note ?? null,
        details: input.details ?? {},
      })
      .select("id"),
  );
}

export async function getAdminActions(groupId: string, limit = 100): Promise<AdminAction[]> {
  const result = await db()
    .from("admin_actions")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (unwrap(result) as AdminAction[]) ?? [];
}

export async function addPointAdjustment(input: {
  groupId: string;
  userId: string;
  weekId: string | null;
  points: number;
  note: string;
  createdBy: string;
}): Promise<void> {
  unwrap(
    await db()
      .from("point_adjustments")
      .insert({
        group_id: input.groupId,
        user_id: input.userId,
        week_id: input.weekId,
        points: input.points,
        note: input.note,
        created_by: input.createdBy,
      })
      .select("id"),
  );
}

export async function getPointAdjustments(groupId: string): Promise<PointAdjustment[]> {
  const result = await db()
    .from("point_adjustments")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  return (unwrap(result) as PointAdjustment[]) ?? [];
}

/**
 * Admin pick edit. Unlike a member's own pick this ignores kickoff, which is
 * the point -- it exists to correct entry mistakes. Every call is logged.
 */
export async function adminSetPick(
  targetUserId: string,
  gameId: string,
  side: Side | null,
  isLock: boolean,
): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new AppError("That game no longer exists.");

  if (side === null) {
    unwrap(
      await db()
        .from("picks")
        .delete()
        .eq("user_id", targetUserId)
        .eq("game_id", gameId)
        .select("id"),
    );
    return;
  }

  if (isLock) {
    unwrap(
      await db()
        .from("picks")
        .update({ is_lock: false })
        .eq("user_id", targetUserId)
        .eq("week_id", game.week_id)
        .neq("game_id", gameId)
        .select("id"),
    );
  }

  const result = await db()
    .from("picks")
    .upsert(
      {
        user_id: targetUserId,
        game_id: gameId,
        week_id: game.week_id,
        picked_side: side,
        is_lock: isLock,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,game_id" },
    )
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
}

// ---------------------------------------------------------- request cache

/**
 * The lookups several parts of one page ask for.
 *
 * A single request renders a layout and a page, and both want the group and
 * the member; the picks page then wants the week list once per competition and
 * the members again for the board. React's cache keeps the first answer for
 * the rest of that request, so the same question is not put to the database
 * four times. It is per request and nothing is held between them, so a page is
 * never built from another request's data.
 *
 * Only reads are here. Anything that writes, or that must see a write made
 * earlier in the same request, is deliberately left out.
 */
export const getGroup = cache(getGroupOnce);
export const getUser = cache(getUserOnce);
export const getMembers = cache(getMembersOnce);
export const listWeeks = cache(listWeeksOnce);
export const listOpenedWeeks = cache(listOpenedWeeksOnce);
export const listPickableWeeks = cache(listPickableWeeksOnce);
export const listViewableWeeks = cache(listViewableWeeksOnce);
export const sportsWithOpenWeeks = cache(sportsWithOpenWeeksOnce);
export const sportsWithViewableWeeks = cache(sportsWithViewableWeeksOnce);
