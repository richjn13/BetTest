"use client";

import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { formatKickoff, formatPoints, spreadForSide } from "@/lib/format";
import { abbreviate } from "@/lib/teams";
import { NFL_TEAMS } from "@/lib/teams";
import { effectiveSpread } from "@/lib/types";
import type {
  AdminAction,
  Game,
  Group,
  Pick,
  PointAdjustment,
  User,
  Week,
} from "@/lib/types";
import {
  IDLE,
  addGameAction,
  adjustPointsAction,
  deleteGameAction,
  editPickAction,
  overrideGameAction,
  pullLinesAction,
  regenerateCodeAction,
  removeUserAction,
  syncOddsAction,
  type AdminState,
} from "./actions";

type Props = {
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
  const { group, members, weeks, week, games, picks, actions, adjustments } = props;
  const router = useRouter();

  return (
    <div className="space-y-4">
      <Section title="Group">
        <GroupSection group={group} />
      </Section>

      <Section title="Lines">
        <PullSection groupId={group.id} week={week} />
      </Section>

      <Section title="Odds feed">
        <OddsSection groupId={group.id} />
      </Section>

      <Section
        title="Games"
        aside={
          weeks.length > 0 && week ? (
            <select
              value={week.id}
              onChange={(event) =>
                router.push(`/g/${group.id}/admin?week=${event.target.value}`)
              }
              className="field w-auto py-1 text-sm"
            >
              {weeks.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.season_year} · {option.label}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        <GamesSection groupId={group.id} week={week} games={games} weeks={weeks} />
      </Section>

      <Section title="Picks">
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
        <MembersSection groupId={group.id} members={members} />
      </Section>

      <Section title="Audit log">
        <AuditSection actions={actions} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ shells

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="card" open>
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold">{title}</summary>
      <div className="border-t border-edge px-4 py-4">
        {aside && <div className="mb-3 flex justify-end">{aside}</div>}
        {children}
      </div>
    </details>
  );
}

function Feedback({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
        {state.message}
      </p>
    );
  }
  return null;
}

function NoteField({ hint }: { hint: string }) {
  return (
    <div>
      <label className="label">Note (required)</label>
      <input name="note" required className="field" placeholder={hint} />
    </div>
  );
}

// ----------------------------------------------------------------- sections

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

function PullSection({ groupId, week }: { groupId: string; week: Week | null }) {
  const [state, action] = useFormState(pullLinesAction, IDLE);
  const defaultYear = week?.season_year ?? new Date().getUTCFullYear();
  const defaultWeek = week?.week_number ?? 1;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <Feedback state={state} />
      <p className="text-sm text-muted">
        Claude searches for the week&apos;s spreads and writes what it finds. Each
        line is locked at the moment of the pull: the odds feed leaves it alone,
        and only another pull replaces it.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Season</label>
          <input
            name="seasonYear"
            type="number"
            defaultValue={defaultYear}
            required
            className="field"
          />
        </div>
        <div>
          <label className="label">Week (19-22 = playoffs)</label>
          <input
            name="weekNumber"
            type="number"
            min={1}
            max={22}
            defaultValue={defaultWeek}
            required
            className="field"
          />
        </div>
      </div>
      <SubmitButton className="btn" pendingLabel="Searching, this takes a minute...">
        Pull lines with Claude
      </SubmitButton>
      <p className="text-xs text-muted">
        These numbers come from a model reading a betting page, so check the
        slate below before anyone picks. Once a game kicks off its line is final
        and no pull can change it.
      </p>
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

function GamesSection({
  groupId,
  week,
  games,
  weeks,
}: {
  groupId: string;
  week: Week | null;
  games: Game[];
  weeks: Week[];
}) {
  const [addState, addGame] = useFormState(addGameAction, IDLE);
  const [overrideState, override] = useFormState(overrideGameAction, IDLE);
  const [deleteState, remove] = useFormState(deleteGameAction, IDLE);

  const defaultYear = week?.season_year ?? new Date().getUTCFullYear();
  const defaultWeek = week?.week_number ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Add a game by hand</h3>
        <form action={addGame} className="space-y-3">
          <input type="hidden" name="groupId" value={groupId} />
          <Feedback state={addState} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Season</label>
              <input
                name="seasonYear"
                type="number"
                defaultValue={defaultYear}
                required
                className="field"
              />
            </div>
            <div>
              <label className="label">Week (19-22 = playoffs)</label>
              <input
                name="weekNumber"
                type="number"
                min={1}
                max={22}
                defaultValue={defaultWeek}
                required
                className="field"
              />
            </div>
            <div>
              <label className="label">Away team</label>
              <TeamSelect name="awayTeam" />
            </div>
            <div>
              <label className="label">Home team</label>
              <TeamSelect name="homeTeam" />
            </div>
            <div>
              <label className="label">Kickoff (your local time)</label>
              <input name="kickoffTime" type="datetime-local" required className="field" />
            </div>
            <div>
              <label className="label">Home spread</label>
              <input
                name="homeSpread"
                type="number"
                step="0.5"
                placeholder="-3.5"
                className="field"
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Negative means the home team is favored. Leave blank for no line yet.
          </p>
          <SubmitButton className="btn" pendingLabel="Adding...">
            Add game
          </SubmitButton>
        </form>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {week ? `${week.label} slate` : "No week selected"}
        </h3>
        <Feedback state={overrideState} />
        <Feedback state={deleteState} />
        {games.length === 0 ? (
          <p className="text-sm text-muted">No games in this week yet.</p>
        ) : (
          <ul className="space-y-3">
            {games.map((game) => (
              <li key={game.id} className="rounded-lg border border-edge p-3">
                <div className="mb-2 text-sm">
                  <span className="font-medium">
                    {abbreviate(game.away_team)} at {abbreviate(game.home_team)}
                  </span>
                  <span className="ml-2 text-muted">
                    {formatKickoff(game.kickoff_time)} ·{" "}
                    {spreadForSide(effectiveSpread(game), "home")}
                    {game.spread_frozen_at
                      ? " (frozen)"
                      : game.spread_locked_at
                        ? " (locked)"
                        : ""} · {game.status}
                    {game.score_overridden_at ? " · manual" : ""}
                  </span>
                </div>

                <form action={override} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="gameId" value={game.id} />
                  <select name="status" defaultValue={game.status} className="field py-1 text-sm">
                    {["scheduled", "live", "final", "postponed", "canceled"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <input
                    name="finalAwayScore"
                    type="number"
                    placeholder="away"
                    defaultValue={game.final_away_score ?? ""}
                    className="field py-1 text-sm"
                  />
                  <input
                    name="finalHomeScore"
                    type="number"
                    placeholder="home"
                    defaultValue={game.final_home_score ?? ""}
                    className="field py-1 text-sm"
                  />
                  <input
                    name="note"
                    required
                    placeholder="why"
                    className="field py-1 text-sm"
                  />
                  <SubmitButton className="btn py-1 text-sm" pendingLabel="Saving...">
                    Save
                  </SubmitButton>
                </form>

                <form action={remove} className="mt-2 flex gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="gameId" value={game.id} />
                  <input
                    name="note"
                    required
                    placeholder="reason for deleting"
                    className="field py-1 text-sm"
                  />
                  <SubmitButton
                    className="btn shrink-0 border-red-500/40 py-1 text-sm text-red-500"
                    pendingLabel="Deleting..."
                  >
                    Delete game
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {weeks.length === 0 && (
          <p className="mt-2 text-xs text-muted">
            Weeks appear once the first game exists, added here or by the odds feed.
          </p>
        )}
      </div>
    </div>
  );
}

function TeamSelect({ name }: { name: string }) {
  return (
    <select name={name} required defaultValue="" className="field">
      <option value="" disabled>
        Choose a team
      </option>
      {NFL_TEAMS.map((team) => (
        <option key={team} value={team}>
          {team}
        </option>
      ))}
    </select>
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

function MembersSection({ groupId, members }: { groupId: string; members: User[] }) {
  const [state, action] = useFormState(removeUserAction, IDLE);
  return (
    <div className="space-y-3">
      <Feedback state={state} />
      <ul className="space-y-2">
        {members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-24 font-medium">
              {member.username}
              {member.is_admin && <span className="ml-1 text-xs text-muted">admin</span>}
            </span>
            {!member.is_admin && (
              <form action={action} className="flex flex-1 gap-2">
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
        ))}
      </ul>
      <p className="text-xs text-muted">
        Removing a member deletes their picks. There is no undo.
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
