import "server-only";
import { db, unwrap } from "./db";
import { generateJoinCode, hashPin, timingSafeEquals, verifyPin } from "./crypto";
import { env } from "./env";
import { weekLabel } from "./format";
import { buildStandings, type Adjustment, type ScoredPick, type Standing } from "./scoring";
import {
  isGameOpen,
  type AdminAction,
  type Game,
  type GameCard,
  type Group,
  type Pick,
  type PointAdjustment,
  type Side,
  type User,
  type Week,
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

export async function getGroup(groupId: string): Promise<Group | null> {
  const result = await db().from("groups").select("*").eq("id", groupId).maybeSingle();
  return unwrap(result) as Group | null;
}

export async function getGroupByJoinCode(joinCode: string): Promise<Group | null> {
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

export async function getUser(userId: string): Promise<User | null> {
  const result = await db().from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
  return unwrap(result) as User | null;
}

export async function getMembers(groupId: string): Promise<User[]> {
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
  "id, season_year, week_number, season_type, label, opened_at, closed_at";

export async function listWeeks(seasonYear?: number): Promise<Week[]> {
  let query = db().from("weeks").select(WEEK_COLUMNS).order("season_year").order("week_number");
  if (seasonYear !== undefined) query = query.eq("season_year", seasonYear);
  return ((unwrap(await query) as Week[]) ?? []);
}

/**
 * The weeks members can see. A week appears only once its lines have been
 * pulled, so next week's games never show up early.
 */
export async function listOpenedWeeks(): Promise<Week[]> {
  const result = await db()
    .from("weeks")
    .select(WEEK_COLUMNS)
    .not("opened_at", "is", null)
    .order("season_year")
    .order("week_number");
  return (unwrap(result) as Week[]) ?? [];
}

/** Marks a week as visible. Called the first time lines land in it. */
export async function openWeek(weekId: string): Promise<void> {
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
export async function setWeekClosed(weekId: string, closed: boolean): Promise<void> {
  unwrap(
    await db()
      .from("weeks")
      .update({ closed_at: closed ? new Date().toISOString() : null })
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
): Promise<Week> {
  const existing = unwrap(
    await db()
      .from("weeks")
      .select(WEEK_COLUMNS)
      .eq("season_year", seasonYear)
      .eq("week_number", weekNumber)
      .maybeSingle(),
  ) as Week | null;
  if (existing) return existing;

  const seasonType = weekNumber <= 18 ? "regular" : "postseason";
  const result = await db()
    .from("weeks")
    .insert({
      season_year: seasonYear,
      week_number: weekNumber,
      season_type: seasonType,
      label: weekLabel(weekNumber, seasonType),
    })
    .select(WEEK_COLUMNS)
    .single();

  if (result.error) {
    // Another request created it between the read and the write.
    if (isUniqueViolation(result.error)) return (await ensureWeek(seasonYear, weekNumber));
    throw new Error(result.error.message);
  }
  return result.data as Week;
}

/**
 * The week to show by default: the earliest opened week that still has a game
 * to come, otherwise the most recently opened week.
 */
export async function getCurrentWeek(): Promise<Week | null> {
  const opened = await listOpenedWeeks();
  if (opened.length === 0) return null;

  // A finished week should never be what the page opens on.
  const live = opened.filter((week) => week.closed_at === null);
  const candidates = live.length > 0 ? live : opened;
  const openedIds = new Set(candidates.map((week) => week.id));
  const upcoming =
    unwrap<{ week_id: string }[]>(
      await db()
        .from("games")
        .select("week_id, kickoff_time")
        .gt("kickoff_time", new Date().toISOString())
        .order("kickoff_time")
        .limit(20),
    ) ?? [];

  const next = upcoming.find((game) => openedIds.has(game.week_id));
  if (next) return candidates.find((week) => week.id === next.week_id) ?? null;

  return candidates.at(-1) ?? null;
}

// ------------------------------------------------------------------- games

const GAME_COLUMNS =
  "id, week_id, home_team, away_team, kickoff_time, home_spread, spread_source, " +
  "spread_updated_at, spread_frozen_at, frozen_home_spread, final_home_score, " +
  "final_away_score, score_overridden_at, status, odds_api_event_id, spread_locked_at";

export async function getGamesForWeek(weekId: string): Promise<Game[]> {
  const result = await db()
    .from("games")
    .select(GAME_COLUMNS)
    .eq("week_id", weekId)
    .order("kickoff_time")
    .order("home_team");
  return (unwrap(result) as Game[]) ?? [];
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
  games: { awayTeam: string; homeTeam: string; kickoffIso: string; homeSpread: number }[],
  source: string,
): Promise<{ inserted: number; updated: number; skippedFrozen: number }> {
  await assertWeekOpen(weekId);
  await openWeek(weekId);

  const existing = await getGamesForWeek(weekId);
  const byMatchup = new Map(
    existing.map((game) => [`${game.away_team}@${game.home_team}`, game]),
  );

  const now = new Date().toISOString();
  const counts = { inserted: 0, updated: 0, skippedFrozen: 0 };

  for (const game of games) {
    const match = byMatchup.get(`${game.awayTeam}@${game.homeTeam}`);

    if (match) {
      // Frozen, already under way, or already resolved: leave it alone. Only
      // spread_frozen_at is set by the scheduled freeze, so a game that
      // reached kickoff before any run happened would otherwise have its line
      // and kickoff rewritten by a re-pull.
      if (
        match.spread_frozen_at ||
        match.status !== "scheduled" ||
        new Date(match.kickoff_time).getTime() <= Date.now()
      ) {
        counts.skippedFrozen += 1;
        continue;
      }
      unwrap(
        await db()
          .from("games")
          .update({
            home_spread: game.homeSpread,
            kickoff_time: game.kickoffIso,
            spread_source: source,
            spread_updated_at: now,
            spread_locked_at: now,
          })
          .eq("id", match.id)
          .is("spread_frozen_at", null)
          .select("id"),
      );
      counts.updated += 1;
      continue;
    }

    const insert = await db()
      .from("games")
      .insert({
        week_id: weekId,
        home_team: game.homeTeam,
        away_team: game.awayTeam,
        kickoff_time: game.kickoffIso,
        home_spread: game.homeSpread,
        spread_source: source,
        spread_updated_at: now,
        spread_locked_at: now,
      })
      .select("id");
    if (!insert.error) counts.inserted += 1;
  }

  return counts;
}

export async function deleteGame(gameId: string): Promise<void> {
  unwrap(await db().from("games").delete().eq("id", gameId).select("id"));
}

// ------------------------------------------------------------------- picks

const PICK_COLUMNS =
  "id, user_id, game_id, week_id, picked_side, is_lock, locked_at, points_awarded";

export async function getPicksForUserWeek(userId: string, weekId: string): Promise<Pick[]> {
  const result = await db()
    .from("picks")
    .select(PICK_COLUMNS)
    .eq("user_id", userId)
    .eq("week_id", weekId);
  return (unwrap(result) as Pick[]) ?? [];
}

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
  const [games, members] = await Promise.all([getGamesForWeek(weekId), getMembers(groupId)]);
  const memberIds = members.map((member) => member.id);
  const allPicks = await getPicksForWeek(weekId, memberIds);

  const usernames = new Map(members.map((member) => [member.id, member.username]));
  const byGame = new Map<string, Pick[]>();
  for (const pick of allPicks) {
    const list = byGame.get(pick.game_id);
    if (list) list.push(pick);
    else byGame.set(pick.game_id, [pick]);
  }

  const now = new Date();
  return games.map((game) => {
    const picks = byGame.get(game.id) ?? [];
    const open = isGameOpen(game, now);
    const kickedOff = new Date(game.kickoff_time).getTime() <= now.getTime();

    return {
      game,
      pick: picks.find((pick) => pick.user_id === userId) ?? null,
      isOpen: open,
      // Picks stay hidden until each game kicks off, so nobody can copy.
      revealed: kickedOff
        ? picks
            .filter((pick) => pick.user_id !== userId)
            .map((pick) => ({
              username: usernames.get(pick.user_id) ?? "?",
              side: pick.picked_side,
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,game_id" },
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

  const picks = (unwrap<PickWithGame[]>(pickRows) ?? []).map(toScoredPick);
  const adjustmentRowsTyped =
    unwrap<{ user_id: string; week_id: string | null; points: number }[]>(adjustmentRows) ?? [];
  const adjustments: Adjustment[] = adjustmentRowsTyped.map((row) => ({
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
