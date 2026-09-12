"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { InviteMessage } from "./InviteMessage";
import { formatPoints, shortDate, weekChoiceLabel } from "@/lib/format";
import { weekPlayDateUtc } from "@/lib/season-week";
import { abbreviate } from "@/lib/teams";
import { SPORTS, sportConfig, sportLabel, type Sport } from "@/lib/sports";
import type {
  AdminAction,
  Game,
  Group,
  Pick,
  PointAdjustment,
  User,
  Week,
} from "@/lib/types";
import { IDLE } from "./state";
import { Feedback, NoteField, Section } from "./ui";
import {
  adjustPointsAction,
  editPickAction,
  pullGamesAction,
  pullTotalsAction,
  regenerateCodeAction,
  removeUserAction,
  setAdminAction,
  setWeekClosedAction,
  syncOddsAction,
} from "./actions";

type Props = {
  viewerId: string;
  group: Group;
  members: User[];
  weeks: Week[];
  week: Week | null;
  games: Game[];
  picks: Pick[];
  actions: AdminAction[];
  adjustments: PointAdjustment[];
};

export function AdminPanel(props: Props) {
  const { viewerId, group, members, weeks, week, games, picks, actions, adjustments } = props;

  return (
    <div className="space-y-4">
      <Section title="Group">
        <GroupSection group={group} />
      </Section>

      <Section title="Invite someone">
        {/* Keyed by the code so regenerating it rewrites the message. */}
        <InviteMessage
          key={group.join_code}
          groupName={group.name}
          joinCode={group.join_code}
        />
      </Section>

      {SPORTS.map((sport) => (
        <Section key={sport} title={`Pull ${sportLabel(sport)}`}>
          <GamesPullSection groupId={group.id} sport={sport} weeks={weeks} />
          <TotalsPullSection
            groupId={group.id}
            sport={sport}
            weeks={weeks}
            week={week}
            games={games}
          />
        </Section>
      ))}

      <Section title="Week status">
        <WeekStatusSection groupId={group.id} weeks={weeks} />
      </Section>

      <Section title="Odds feed">
        <OddsSection groupId={group.id} />
      </Section>

      <Section title="Games">
        <p className="text-sm text-muted">
          The slate, scores, kickoff times and over/unders live on their own
          page. They change constantly during a week, and every change reloads
          the page they sit on, which is no way to share a page with buttons
          that spend money.
        </p>
        <Link href={`/g/${group.id}/admin/games`} className="btn-primary mt-3 inline-block">
          Open the games page
        </Link>
      </Section>

      <Section
        title="Picks"
        aside={
          weeks.length > 0 && week ? (
            <WeekPicker groupId={group.id} weeks={weeks} week={week} />
          ) : null
        }
      >
        <PicksSection groupId={group.id} members={members} games={games} picks={picks} />
      </Section>

      <Section title="Points adjustments">
        <AdjustmentsSection
          groupId={group.id}
          members={members}
          weeks={weeks}
          adjustments={adjustments}
        />
      </Section>

      <Section title="Members">
        <MembersSection groupId={group.id} members={members} viewerId={viewerId} />
      </Section>

      <Section title="Audit log">
        <AuditSection actions={actions} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ shells

// ----------------------------------------------------------------- sections

/** Chooses which week the picks list below is showing. */
function WeekPicker({
  groupId,
  weeks,
  week,
}: {
  groupId: string;
  weeks: Week[];
  week: Week;
}) {
  const router = useRouter();
  return (
    <select
      value={week.id}
      onChange={(event) => router.push(`/g/${groupId}/admin?week=${event.target.value}`)}
      className="field w-auto py-1 text-sm"
      aria-label="Week"
    >
      {[...weeks].reverse().map((option) => (
        <option key={option.id} value={option.id}>
          {sportLabel(option.sport)} · {weekChoiceLabel(option)}
        </option>
      ))}
    </select>
  );
}

function GroupSection({ group }: { group: Group }) {
  const [state, action] = useFormState(regenerateCodeAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={group.id} />
      <Feedback state={state} />
      <p className="text-sm text-muted">
        Current join code:{" "}
        <span className="font-mono text-base font-semibold tracking-widest text-ink">
          {group.join_code}
        </span>
      </p>
      <SubmitButton className="btn" pendingLabel="Generating...">
        Regenerate join code
      </SubmitButton>
      <p className="text-xs text-muted">
        The old code stops working immediately. Members already in the pool stay in.
      </p>
    </form>
  );
}

function WeekStatusSection({ groupId, weeks }: { groupId: string; weeks: Week[] }) {
  const [state, action] = useFormState(setWeekClosedAction, IDLE);
  const opened = weeks.filter((week) => week.opened_at !== null);

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      <p className="text-sm text-muted">
        A week appears to members once its lines are pulled. Closing it fixes
        everything in place: no line refresh, no pick, no re-pull.
      </p>

      {opened.length === 0 ? (
        <p className="text-sm text-muted">No weeks opened yet.</p>
      ) : (
        <ul className="space-y-2">
          {[...opened].reverse().map((week) => (
            <li
              key={week.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg
                         border border-edge p-3"
            >
              <span className="text-sm font-medium">
                <span className="mr-2 rounded bg-edge px-1.5 py-0.5 text-xs font-semibold">
                  {sportLabel(week.sport)}
                </span>
                {weekChoiceLabel(week)}
                <span className="ml-2 text-xs font-normal text-muted">
                  {week.closed_at ? "closed" : "open"}
                </span>
              </span>
              <form action={action}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="weekId" value={week.id} />
                <input type="hidden" name="close" value={week.closed_at ? "false" : "true"} />
                <SubmitButton className="btn py-1 text-sm" pendingLabel="Saving...">
                  {week.closed_at ? "Reopen" : "Close week"}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One pull box per competition. They were a single form with a competition
 * dropdown, which meant every pull started by checking which sport was
 * selected -- and the NFL and college slates are pulled at different times in
 * the week, for different reasons, by someone thinking about one of them.
 */
function GamesPullSection({
  groupId,
  sport,
  weeks,
}: {
  groupId: string;
  sport: Sport;
  weeks: Week[];
}) {
  const [state, action] = useFormState(pullGamesAction, IDLE);
  const config = sportConfig(sport);
  const lowest = sport === "ncaaf" ? 0 : 1;

  // The week to offer: the one after the last one pulled for this sport, since
  // pulling the same week twice is the rarer thing to want.
  const latest = weeks.filter((week) => week.sport === sport).at(-1) ?? null;
  const [seasonYear, setSeasonYear] = useState(
    latest?.season_year ?? new Date().getUTCFullYear(),
  );
  const [weekNumber, setWeekNumber] = useState(
    Math.min(config.highestWeek, (latest?.week_number ?? lowest) + (latest ? 1 : 0)),
  );

  const played = weekPlayDateUtc(seasonYear, weekNumber, sport);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="sport" value={sport} />
      <Feedback state={state} />
      <p className="text-sm text-muted">
        {sport === "ncaaf"
          ? "Takes the twenty best Saturday games of the week: ranked teams first, then the closest lines."
          : "Takes the full slate for the week."}{" "}
        Each line is locked at the moment of the pull, so the odds feed leaves
        it alone and only another pull replaces it.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Season</label>
          <input
            name="seasonYear"
            type="number"
            value={seasonYear}
            onChange={(event) => setSeasonYear(Number(event.target.value))}
            required
            className="field"
          />
        </div>
        <div>
          <label className="label">
            Week {sport === "ncaaf" ? "(0 = week zero)" : "(19-22 = playoffs)"}
          </label>
          <input
            name="weekNumber"
            type="number"
            min={lowest}
            max={config.highestWeek}
            value={weekNumber}
            onChange={(event) => setWeekNumber(Number(event.target.value))}
            required
            className="field"
          />
        </div>
        <div className="col-span-2">
          <label className="label">Where from</label>
          <select name="source" defaultValue="feed" className="field">
            <option value="feed">The odds feed (one request, exact names)</option>
            <option value="claude">Claude web search (slower, use if the feed is empty)</option>
          </select>
        </div>
      </div>
      <p className="text-sm">
        Pulling{" "}
        <strong>
          {config.label} week {weekNumber}
        </strong>
        , played {sport === "ncaaf" ? "Saturday" : "Sunday"} {shortDate(played)}.
      </p>
      <SubmitButton className="btn" pendingLabel="Pulling...">
        Pull {config.label} games
      </SubmitButton>
    </form>
  );
}

function TotalsPullSection({
  groupId,
  sport,
  weeks,
  week,
  games,
}: {
  groupId: string;
  sport: Sport;
  weeks: Week[];
  week: Week | null;
  games: Game[];
}) {
  const [state, action] = useFormState(pullTotalsAction, IDLE);

  // The open week of this sport, which is the only one a total can land in.
  const target =
    weeks
      .filter((entry) => entry.sport === sport && entry.opened_at && !entry.closed_at)
      .at(-1) ?? null;

  // Flag counts are only known for the week the page loaded games for.
  const showing = target && week && target.id === week.id ? games : null;
  const flagged = showing?.filter((game) => game.totals_enabled) ?? null;
  const awaiting = flagged?.filter((game) => game.total_points === null) ?? null;

  if (!target) {
    return (
      <p className="mt-6 border-t border-edge pt-4 text-sm text-muted">
        No open {sportConfig(sport).label} week, so there is nothing to pull
        over/unders for yet.
      </p>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-3 border-t border-edge pt-4">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="weekId" value={target.id} />
      <input type="hidden" name="sport" value={sport} />
      <Feedback state={state} />
      <p className="text-sm text-muted">
        Turn the over/under on for the games you want it on, over on the Games
        page, then fetch every number here. One request, however many games you
        flagged.
      </p>
      <p className="text-sm">
        {weekChoiceLabel(target)}
        {flagged
          ? `: ${flagged.length} game${flagged.length === 1 ? "" : "s"} flagged` +
            (awaiting && awaiting.length > 0
              ? `, ${awaiting.length} still without a number`
              : "")
          : ""}
        .
      </p>
      <SubmitButton className="btn" pendingLabel="Pulling...">
        Pull {sportConfig(sport).label} totals
      </SubmitButton>
    </form>
  );
}

function OddsSection({ groupId }: { groupId: string }) {
  const [state, action] = useFormState(syncOddsAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <Feedback state={state} />
      <p className="text-sm text-muted">
        Cron refreshes spreads and scores on its own. Use this to pull immediately.
      </p>
      <SubmitButton className="btn" pendingLabel="Refreshing...">
        Refresh odds and scores now
      </SubmitButton>
    </form>
  );
}

function PicksSection({
  groupId,
  members,
  games,
  picks,
}: {
  groupId: string;
  members: User[];
  games: Game[];
  picks: Pick[];
}) {
  const [state, action] = useFormState(editPickAction, IDLE);
  const byUser = new Map<string, Pick[]>();
  for (const pick of picks) {
    const list = byUser.get(pick.user_id);
    if (list) list.push(pick);
    else byUser.set(pick.user_id, [pick]);
  }
  const gamesById = new Map(games.map((game) => [game.id, game]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Editing a pick here ignores kickoff, which is the point: it exists to fix entry
        mistakes, not to change a call after the result is known. Every edit is logged.
      </p>

      <form action={action} className="space-y-3">
        <input type="hidden" name="groupId" value={groupId} />
        <Feedback state={state} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Member</label>
            <select name="targetUserId" required defaultValue="" className="field">
              <option value="" disabled>
                Choose
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Game</label>
            <select name="gameId" required defaultValue="" className="field">
              <option value="" disabled>
                Choose
              </option>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {abbreviate(game.away_team)} at {abbreviate(game.home_team)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Side</label>
            <select name="side" defaultValue="home" className="field">
              <option value="away">Away team</option>
              <option value="home">Home team</option>
              <option value="none">Clear the pick</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="isLock" className="h-4 w-4" />
              Mark as their lock
            </label>
          </div>
        </div>
        <NoteField hint="e.g. entered the wrong side on their behalf" />
        <SubmitButton className="btn" pendingLabel="Saving...">
          Save pick
        </SubmitButton>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Current picks this week</h3>
        {members.length === 0 ? (
          <p className="text-sm text-muted">No members yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {members.map((member) => {
              const theirs = byUser.get(member.id) ?? [];
              return (
                <li key={member.id} className="flex flex-wrap gap-x-2 gap-y-1">
                  <span className="font-medium">{member.username}</span>
                  {theirs.length === 0 ? (
                    <span className="text-muted">no picks</span>
                  ) : (
                    theirs.map((pick) => {
                      const game = gamesById.get(pick.game_id);
                      if (!game) return null;
                      const team =
                        pick.picked_side === "home" ? game.home_team : game.away_team;
                      return (
                        <span key={pick.id} className="text-muted">
                          {abbreviate(team)}
                          {pick.is_lock && "🔒"}
                        </span>
                      );
                    })
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function AdjustmentsSection({
  groupId,
  members,
  weeks,
  adjustments,
}: {
  groupId: string;
  members: User[];
  weeks: Week[];
  adjustments: PointAdjustment[];
}) {
  const [state, action] = useFormState(adjustPointsAction, IDLE);
  const usernames = new Map(members.map((member) => [member.id, member.username]));
  const weekLabels = new Map(weeks.map((week) => [week.id, week.label]));

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="groupId" value={groupId} />
        <Feedback state={state} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Member</label>
            <select name="userId" required defaultValue="" className="field">
              <option value="" disabled>
                Choose
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Week (optional)</label>
            <select name="weekId" defaultValue="" className="field">
              <option value="">Season total</option>
              {weeks.map((week) => (
                <option key={week.id} value={week.id}>
                  {week.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Points</label>
            <input name="points" type="number" step="0.5" required className="field" />
          </div>
        </div>
        <NoteField hint="e.g. credit for a game we voided" />
        <SubmitButton className="btn" pendingLabel="Applying...">
          Apply adjustment
        </SubmitButton>
      </form>

      {adjustments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="text-muted">
              <span className="font-medium text-ink">
                {usernames.get(adjustment.user_id) ?? "Unknown"}{" "}
                {Number(adjustment.points) > 0 ? "+" : ""}
                {formatPoints(Number(adjustment.points))}
              </span>{" "}
              {adjustment.week_id ? `(${weekLabels.get(adjustment.week_id) ?? "week"})` : "(season)"}{" "}
              — {adjustment.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MembersSection({
  groupId,
  members,
  viewerId,
}: {
  groupId: string;
  members: User[];
  viewerId: string;
}) {
  const [removeState, remove] = useFormState(removeUserAction, IDLE);
  const [adminState, changeAdmin] = useFormState(setAdminAction, IDLE);
  const adminCount = members.filter((member) => member.is_admin).length;

  return (
    <div className="space-y-4">
      <Feedback state={adminState} />
      <Feedback state={removeState} />

      <ul className="space-y-3">
        {members.map((member) => {
          const isLastAdmin = member.is_admin && adminCount === 1;
          return (
            <li key={member.id} className="rounded-lg border border-edge p-3">
              <p className="mb-2 text-sm font-medium">
                {member.username}
                {member.is_admin && (
                  <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                    admin
                  </span>
                )}
                {member.id === viewerId && (
                  <span className="ml-2 text-xs text-muted">you</span>
                )}
              </p>

              {isLastAdmin ? (
                <p className="text-xs text-muted">
                  The only admin. Promote someone else before changing this.
                </p>
              ) : (
                <form action={changeAdmin} className="flex gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="userId" value={member.id} />
                  <input type="hidden" name="username" value={member.username} />
                  <input
                    type="hidden"
                    name="makeAdmin"
                    value={member.is_admin ? "false" : "true"}
                  />
                  <input
                    name="note"
                    required
                    placeholder="reason"
                    className="field py-1 text-sm"
                  />
                  <SubmitButton className="btn shrink-0 py-1 text-sm" pendingLabel="Saving...">
                    {member.is_admin ? "Remove admin" : "Make admin"}
                  </SubmitButton>
                </form>
              )}

              {!member.is_admin && (
                <form action={remove} className="mt-2 flex gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="userId" value={member.id} />
                  <input type="hidden" name="username" value={member.username} />
                  <input
                    name="note"
                    required
                    placeholder="reason for removing"
                    className="field py-1 text-sm"
                  />
                  <SubmitButton
                    className="btn shrink-0 border-red-500/40 py-1 text-sm text-red-500"
                    pendingLabel="Removing..."
                  >
                    Remove
                  </SubmitButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted">
        An admin can do everything on this page, including editing picks and
        adjusting points. Removing a member deletes their picks, and there is no
        undo. Demote an admin before removing them.
      </p>
    </div>
  );
}

function AuditSection({ actions }: { actions: AdminAction[] }) {
  if (actions.length === 0) {
    return <p className="text-sm text-muted">Nothing logged yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {actions.map((entry) => (
        <li key={entry.id} className="border-b border-edge/60 pb-2 last:border-0">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">
              {entry.actor_username} · {entry.action.replace(/_/g, " ")}
            </span>
            <time className="text-xs text-muted" dateTime={entry.created_at}>
              {new Date(entry.created_at).toLocaleString()}
            </time>
          </div>
          {entry.note && <p className="text-muted">{entry.note}</p>}
          {Object.keys(entry.details ?? {}).length > 0 && (
            <p className="font-mono text-xs text-muted">{JSON.stringify(entry.details)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
