"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, unwrap } from "@/lib/db";
import { gradeResolvedGames } from "@/lib/grading";
import { pullLinesWithClaude } from "@/lib/claude-odds";
import { pullLinesFromFeed, pullTotalsFromFeed } from "@/lib/odds";
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
  applyTotals,
  setGameTotal,
  setTotalsEnabled,
  setWeekClosed,
} from "@/lib/queries";
import { isSport, sportConfig, sportLabel, type Sport } from "@/lib/sports";
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

// ------------------------------------------------------------------- pulls

/** How many college games a pull offers. The full Saturday slate is unpickable. */
const NCAAF_SLATE_SIZE = 20;

function readSport(form: FormData): Sport {
  const value = text(form, "sport");
  return isSport(value) ? value : "nfl";
}

/**
 * Fills in the week's games and spreads, and locks every number it writes:
 * the odds feed will not touch a locked line, and only another deliberate pull
 * can replace it.
 *
 * Two sources. The odds feed is the default and the one to use -- exact team
 * names, exact kickoff times, one request. Claude's web search is kept as a
 * fallback for a week the feed has not posted, and it is the slower and less
 * reliable of the two, so nothing chooses it automatically.
 */
export async function pullGamesAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const seasonYear = optionalNumber(form, "seasonYear");
  const weekNumber = optionalNumber(form, "weekNumber");
  const sport = readSport(form);
  const useClaude = text(form, "source") === "claude";
  const config = sportConfig(sport);

  return run(groupId, async (actor) => {
    if (!seasonYear || weekNumber === null) throw new AppError("Pick a season and week.");
    const lowest = sport === "ncaaf" ? 0 : 1;
    if (weekNumber < lowest || weekNumber > config.highestWeek) {
      throw new AppError(
        `${config.label} weeks run ${lowest} to ${config.highestWeek}.`,
      );
    }

    const limit = sport === "ncaaf" ? NCAAF_SLATE_SIZE : null;
    const pulled = useClaude
      ? await pullLinesWithClaude(seasonYear, weekNumber, sport)
      : await pullLinesFromFeed(seasonYear, weekNumber, sport, limit);
    if (!pulled.ok) throw new AppError(pulled.error ?? "The pull came back empty.");

    const week = await ensureWeek(seasonYear, weekNumber, sport);
    const source = pulled.source
      ? `${useClaude ? "claude" : "odds"}:${pulled.source}`
      : useClaude
        ? "claude"
        : "odds";
    const counts = await applyLockedLines(week.id, pulled.games, source);

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "pull_lines",
      note: `Lines pulled and locked for ${sportLabel(sport)} ${week.label}.`,
      details: {
        sport,
        via: useClaude ? "claude" : "odds feed",
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

    const rejected =
      pulled.rejected.length > 0
        ? ` Left out ${pulled.rejected.length}: ${pulled.rejected.join("; ")}.`
        : "";

    return `${parts.join(", ")}. Check the slate below before anyone picks.${moved}${missing}${rejected}`;
  });
}

/**
 * Fetches over/under numbers for the games flagged for one, and writes them.
 *
 * One request per pull, and only the flagged games are touched, so turning the
 * over/under on for three games costs exactly what turning it on for twenty
 * does.
 */
export async function pullTotalsAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const weekId = text(form, "weekId");
  const sport = readSport(form);

  return run(groupId, async (actor) => {
    if (!weekId) throw new AppError("Pick a week.");
    const week = await getWeek(weekId);
    if (!week) throw new AppError("That week no longer exists.");

    const pulled = await pullTotalsFromFeed(sport);
    if (!pulled.ok) throw new AppError(pulled.error ?? "The totals pull came back empty.");

    const counts = await applyTotals(weekId, pulled.totals);

    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "pull_totals",
      note: `Over/unders pulled for ${sportLabel(sport)} ${week.label}.`,
      details: { sport, week: week.label, ...counts },
    });

    if (counts.filled === 0 && counts.unchanged === 0 && counts.waiting.length === 0) {
      return "No game in this week has its over/under turned on yet. Toggle one on under Games, then pull.";
    }

    const waiting =
      counts.waiting.length > 0
        ? ` Still waiting on a number: ${counts.waiting.join("; ")}. ` +
          "Books post totals closer to kickoff, or you can type one in."
        : "";

    return (
      `${counts.filled} over/under${counts.filled === 1 ? "" : "s"} written` +
      `${counts.unchanged > 0 ? `, ${counts.unchanged} already current` : ""}.${waiting}`
    );
  });
}

/** Turns the over/under on for a game, or off, without setting a number. */
export async function toggleTotalAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const gameId = text(form, "gameId");
  const enabled = text(form, "enabled") === "true";

  return run(groupId, async (actor) => {
    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");

    await setTotalsEnabled(gameId, enabled);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: enabled ? "enable_total" : "disable_total",
      gameId,
      note: enabled ? "Over/under turned on, awaiting a number." : "Over/under removed.",
      details: { matchup: `${game.away_team} at ${game.home_team}` },
    });

    return enabled
      ? "Over/under on. Pull totals to fill in the number."
      : "Over/under removed from that game.";
  });
}

/** Sets an over/under by hand, for a game the feed has no number for. */
export async function setTotalAction(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const groupId = text(form, "groupId");
  const gameId = text(form, "gameId");
  const total = optionalNumber(form, "total");

  return run(groupId, async (actor) => {
    const game = await getGame(gameId);
    if (!game) throw new AppError("That game no longer exists.");
    if (total === null) throw new AppError("Enter the over/under number.");

    await setGameTotal(gameId, total);
    await logAdminAction({
      groupId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      action: "enable_total",
      gameId,
      note: `Over/under set to ${total} by hand.`,
      details: { matchup: `${game.away_team} at ${game.home_team}`, total },
    });

    return `Over/under set to ${total}. Members can now pick it.`;
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
