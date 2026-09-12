"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, unwrap } from "@/lib/db";
import { gradeResolvedGames } from "@/lib/grading";
import { pullLinesWithClaude } from "@/lib/claude-odds";
import { runRefresh, summarize } from "@/lib/refresh";
import {
  AppError,
  addPointAdjustment,
  applyLockedLines,
  adminSetPick,
  createGame,
  deleteGame,
  ensureWeek,
  getGame,
  getWeek,
  logAdminAction,
  regenerateJoinCode,
  removeUser,
  setAdmin,
  setGameTotal,
  setWeekClosed,
} from "@/lib/queries";
import { isSport, sportLabel, type Sport } from "@/lib/sports";
import type { GameStatus, Side } from "@/lib/types";

import type { AdminState } from "./state";

export type { AdminState };

function text(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

function optionalNumber(form: FormData, field: string): number | null {
  const raw = text(form, field);
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Shared wrapper: confirms the caller administers this group, turns AppError
 * into a message for the panel, and refreshes the page on success.
 */
/**
 * Next signals redirect() and notFound() by throwing. A catch-all that
 * swallows those turns a redirect into a confusing message instead of moving
 * the browser, so they are passed straight through.
 */
function rethrowIfNavigation(error: unknown): void {
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return;
  if (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND") throw error;
}

async function run(
  groupId: string,
  work: (actor: { id: string; username: string }) => Promise<string>,
): Promise<AdminState> {
  // Outside the try: a non-admin reaching this is redirected, and a redirect
  // must not be caught.
  const { user } = await requireAdmin(groupId);

  try {
    const message = await work({ id: user.id, username: user.username });
    revalidatePath(`/g/${groupId}/admin`);
    revalidatePath(`/g/${groupId}/picks`);
    revalidatePath(`/g/${groupId}/leaderboard`);
    return { error: null, message };
  } catch (error) {
    rethrowIfNavigation(error);
    if (error instanceof AppError) return { error: error.message, message: null };
    // Anything else is a bug or an outage. Say what it was. This panel is
    // admin-only, the text comes from Postgres or an upstream API rather than
    // from user data, and "that didn't work" cannot be acted on.
    console.error(error);
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `That didn't work: ${reason}`, message: null };
  }
}

// ------------------------------------------------------------------- group

export async function regenerateCodeAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  return run(groupId, async (actor) => {
    const code = await regenerateJoinCode(groupId);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "regenerate_join_code",
      note: "Previous code no longer works.",
    });
    return `New join code: ${code}`;
  });
}

/**
 * Promotes or demotes a member. An admin can do everything on this page, so
 * both directions are logged with a required note.
 */
export async function setAdminAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const userId = text(form, "userId");
  const username = text(form, "username");
  const makeAdmin = text(form, "makeAdmin") === "true";
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (!userId) throw new AppError("Pick a member.");
    if (!note) throw new AppError("Add a note explaining the change.");

    await setAdmin(groupId, userId, makeAdmin);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: makeAdmin ? "grant_admin" : "revoke_admin",
      targetUserId: userId,
      note,
      details: { username },
    });

    if (!makeAdmin && userId === actor.id) {
      return `You are no longer an admin. This page will stop being available.`;
    }
    return makeAdmin
      ? `${username} is now an admin and can do everything on this page.`
      : `${username} is no longer an admin.`;
  });
}

export async function removeUserAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const userId = text(form, "userId");
  const username = text(form, "username");
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (userId === actor.id) throw new AppError("You can't remove yourself.");
    if (!note) throw new AppError("Add a note explaining the removal.");

    // Log before the delete: the audit row references the user id.
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "remove_user",
      note,
      details: { username },
    });
    await removeUser(groupId, userId);
    return `Removed ${username}. Their picks went with them.`;
  });
}

/**
 * Closes a week, or reopens one closed by mistake. A closed week accepts
 * nothing: no line refresh, no pick, no re-pull.
 */
export async function setWeekClosedAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const weekId = text(form, "weekId");
  const close = text(form, "close") === "true";

  return run(groupId, async (actor) => {
    if (!weekId) throw new AppError("Pick a week.");
    const week = await getWeek(weekId);
    if (!week) throw new AppError("That week no longer exists.");

    await setWeekClosed(weekId, close);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: close ? "close_week" : "reopen_week",
      note: close ? `${week.label} finalised.` : `${week.label} reopened.`,
      details: { week: week.label },
    });

    return close
      ? `${week.label} is closed. Its lines, picks and results are now fixed.`
      : `${week.label} is open again and will accept changes.`;
  });
}

// -------------------------------------------------------------------- games

export async function addGameAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const seasonYear = optionalNumber(form, "seasonYear");
  const weekNumber = optionalNumber(form, "weekNumber");
  const homeTeam = text(form, "homeTeam");
  const awayTeam = text(form, "awayTeam");
  const kickoff = text(form, "kickoffTime");
  const homeSpread = optionalNumber(form, "homeSpread");

  return run(groupId, async (actor) => {
    if (!seasonYear || !weekNumber) throw new AppError("Pick a season and week.");
    if (!homeTeam || !awayTeam) throw new AppError("Both teams are required.");
    if (homeTeam === awayTeam) throw new AppError("A team can't play itself.");

    const kickoffDate = new Date(kickoff);
    if (Number.isNaN(kickoffDate.getTime())) throw new AppError("Enter a valid kickoff time.");

    const week = await ensureWeek(seasonYear, weekNumber);
    const game = await createGame({
      weekId: week.id,
      homeTeam,
      awayTeam,
      kickoffTime: kickoffDate.toISOString(),
      homeSpread,
    });

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "add_game",
      gameId: game.id,
      details: { homeTeam, awayTeam, homeSpread, week: week.label },
    });
    return `Added ${awayTeam} at ${homeTeam}.`;
  });
}

export async function deleteGameAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const gameId = text(form, "gameId");
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (!note) throw new AppError("Add a note explaining the deletion.");
    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "delete_game",
      note,
      details: { homeTeam: game.home_team, awayTeam: game.away_team },
    });
    await deleteGame(gameId);
    return `Deleted ${game.away_team} at ${game.home_team} and every pick on it.`;
  });
}

/**
 * Manual score and status override. Marks the game so the odds feed stops
 * touching it, then regrades every pick on it.
 */
export async function overrideGameAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const gameId = text(form, "gameId");
  const status = text(form, "status") as GameStatus;
  const homeScore = optionalNumber(form, "finalHomeScore");
  const awayScore = optionalNumber(form, "finalAwayScore");
  const kickoff = text(form, "kickoffTime");
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (!note) throw new AppError("Add a note explaining the override.");
    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");
    if (status === "final" && (homeScore === null || awayScore === null)) {
      throw new AppError("A final game needs both scores.");
    }

    // Moving a kickoff is how a flexed game gets corrected by hand when the
    // feed has not caught up. A frozen game keeps its time: picks were already
    // settled against it.
    let kickoffIso: string | null = null;
    if (kickoff) {
      const parsed = new Date(kickoff);
      if (Number.isNaN(parsed.getTime())) throw new AppError("Enter a valid kickoff time.");
      if (game.spread_frozen_at) {
        throw new AppError("This game's line is already frozen, so its kickoff cannot move.");
      }
      kickoffIso = parsed.toISOString();
    }

    unwrap(
      await db()
        .from("games")
        .update({
          status,
          final_home_score: homeScore,
          final_away_score: awayScore,
          score_overridden_at: new Date().toISOString(),
          ...(kickoffIso ? { kickoff_time: kickoffIso } : {}),
        })
        .eq("id", gameId)
        .select("id"),
    );

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "override_game",
      gameId,
      note,
      details: {
        matchup: `${game.away_team} at ${game.home_team}`,
        from: {
          status: game.status,
          home: game.final_home_score,
          away: game.final_away_score,
        },
        to: { status, home: homeScore, away: awayScore },
        ...(kickoffIso ? { kickoffMovedTo: kickoffIso } : {}),
      },
    });

    const regraded = await gradeResolvedGames([gameId]);
    return `Updated the game and regraded ${regraded} pick${regraded === 1 ? "" : "s"}.`;
  });
}

// -------------------------------------------------------------------- picks

export async function editPickAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const targetUserId = text(form, "targetUserId");
  const username = text(form, "username");
  const gameId = text(form, "gameId");
  const side = text(form, "side");
  const isLock = text(form, "isLock") === "on";
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (!note) throw new AppError("Add a note explaining the edit.");
    if (!targetUserId || !gameId) throw new AppError("Pick a member and a game.");
    if (side !== "home" && side !== "away" && side !== "none") {
      throw new AppError("Choose a side, or clear the pick.");
    }

    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");

    await adminSetPick(targetUserId, gameId, side === "none" ? null : (side as Side), isLock);
    await gradeResolvedGames([gameId]);

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "edit_pick",
      targetUserId,
      gameId,
      note,
      details: {
        username,
        matchup: `${game.away_team} at ${game.home_team}`,
        side,
        isLock,
      },
    });
    return side === "none" ? `Cleared ${username}'s pick.` : `Set ${username}'s pick.`;
  });
}

export async function adjustPointsAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const userId = text(form, "userId");
  const username = text(form, "username");
  const weekId = text(form, "weekId");
  const points = optionalNumber(form, "points");
  const note = text(form, "note");

  return run(groupId, async (actor) => {
    if (!note) throw new AppError("A note is required for every points adjustment.");
    if (!userId) throw new AppError("Pick a member.");
    if (points === null || points === 0) {
      throw new AppError("Enter a non-zero adjustment, positive or negative.");
    }

    await addPointAdjustment({
      groupId,
      userId,
      weekId: weekId || null,
      points,
      note,
      createdBy: actor.id,
    });
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "adjust_points",
      targetUserId: userId,
      note,
      details: { username, points, weekId: weekId || null },
    });
    return `Adjusted ${username} by ${points > 0 ? "+" : ""}${points}.`;
  });
}

// ------------------------------------------------------------------- claude

/**
 * Asks Claude to search for the week's lines, then writes what survives
 * validation. Every number is locked at the moment of the pull: the odds feed
 * will not touch it, and only another deliberate pull can replace it.
 */
export async function pullLinesAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const seasonYear = optionalNumber(form, "seasonYear");
  const weekNumber = optionalNumber(form, "weekNumber");
  const sportInput = text(form, "sport");
  const sport: Sport = isSport(sportInput) ? sportInput : "nfl";

  return run(groupId, async (actor) => {
    if (!seasonYear || !weekNumber) throw new AppError("Pick a season and week.");
    if (weekNumber < 1 || weekNumber > 22) throw new AppError("Week must be between 1 and 22.");

    const pulled = await pullLinesWithClaude(seasonYear, weekNumber, sport);
    if (!pulled.ok) {
      throw new AppError(pulled.error ?? "The pull came back empty.");
    }

    const week = await ensureWeek(seasonYear, weekNumber, sport);
    const source = pulled.source ? `claude:${pulled.source}` : "claude";
    const counts = await applyLockedLines(week.id, pulled.games, source);

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "pull_lines",
      note: `Lines pulled and locked for ${sportLabel(sport)} ${week.label}.`,
      details: {
        sport,
        source: pulled.source,
        accepted: pulled.games.length,
        rejected: pulled.rejected,
        ...counts,
      },
    });

    const parts = [
      `${counts.inserted} added, ${counts.updated} updated`,
      counts.skippedFrozen > 0 ? `${counts.skippedFrozen} already frozen and left alone` : null,
      pulled.source ? `from ${pulled.source}` : null,
    ].filter(Boolean);

    const rejected =
      pulled.rejected.length > 0
        ? ` Dropped ${pulled.rejected.length}: ${pulled.rejected.join("; ")}.`
        : "";

    const moved =
      counts.movedKickoff.length > 0
        ? ` Kickoff moved: ${counts.movedKickoff.join("; ")}.`
        : "";

    // Named rather than deleted: removing a game takes every pick on it.
    const missing =
      counts.missing.length > 0
        ? ` NOT IN THIS PULL, so they may have come off the slate: ` +
          `${counts.missing.join("; ")}. Delete them below if they are gone.`
        : "";

    return `${parts.join(", ")}. Check the slate below before anyone picks.${moved}${missing}${rejected}`;
  });
}

/** Turns the over/under on for a game, or off. */
export async function setTotalAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const gameId = text(form, "gameId");
  const remove = text(form, "remove") === "true";
  const total = optionalNumber(form, "total");

  return run(groupId, async (actor) => {
    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");
    if (!remove && total === null) throw new AppError("Enter the over/under number.");

    await setGameTotal(gameId, remove ? null : total);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: remove ? "disable_total" : "enable_total",
      gameId,
      note: remove ? "Over/under removed." : `Over/under set to ${total}.`,
      details: { matchup: `${game.away_team} at ${game.home_team}`, total: remove ? null : total },
    });

    return remove
      ? "Over/under removed from that game."
      : `Over/under set to ${total}. Members can now pick it.`;
  });
}

// --------------------------------------------------------------------- odds

export async function syncOddsAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");

  return run(groupId, async () => {
    const result = await runRefresh();
    const summary = summarize(result);

    if (result.databaseError) {
      throw new AppError(`The database call failed: ${result.databaseError}`);
    }

    // Only a failed spreads pull is worth calling a failure. Scores are a
    // separate endpoint with its own plan restrictions, and a pool that has its
    // lines can still be picked and can still be scored by hand.
    if (result.oddsError) {
      throw new AppError(`Couldn't fetch spreads: ${result.oddsError}`);
    }
    if (result.scoresError) {
      return (
        `${summary} Spreads are current. Scores were unavailable ` +
        `(${result.scoresError}), so results may lag -- you can enter a final ` +
        `score by hand under Games.`
      );
    }
    return summary;
  });
}
