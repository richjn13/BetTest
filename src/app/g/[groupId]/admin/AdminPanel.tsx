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
import { weekState } from "@/lib/types";
import type {
  AdminAction,
  Game,
  Group,
  Pick,
  PointAdjustment,
  User,
  Week,
  WeekState,
} from "@/lib/types";
import { IDLE } from "./state";
import { Feedback, NoteField, SectionStack, type Panel } from "./ui";
import {
  adjustPointsAction,
  editPickAction,
  fetchPollAction,
  pullGamesAction,
  pullTotalsAction,
  regenerateCodeAction,
  removeUserAction,
  setAdminAction,
  savePollAction,
  scrapeScoresAction,
  setWeekStateAction,
  syncScoresAction,
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
  /** The balance written down by the last call the app made. */
  quota: { remaining: number | null; used: number | null; at?: string } | null;
  /** The stored AP Top 25 for the latest college week, if there is one. */
  poll: {
    seasonYear: number;
    weekNumber: number;
    ranked: number;
    source: string;
  } | null;
};

export function AdminPanel(props: Props) {
  const { viewerId, group, members, weeks, week, games, picks, actions, adjustments, quota, poll } =
    props;

  const openWeeks = weeks.filter((entry) => entry.opened_at && !entry.closed_at);
  const flagged = games.filter((game) => game.totals_enabled).length;
  const remaining = quota?.remaining ?? null;

  const panels: Panel[] = [
    {
      id: "update",
      title: "Update a week",
      hint:
        openWeeks.length === 0
          ? "No week open"
          : `Pull scores or odds · ${openWeeks.length} week${openWeeks.length === 1 ? "" : "s"} open`,
      body: <UpdateSection groupId={group.id} weeks={weeks} quota={quota} />,
    },
    ...SPORTS.map((sport): Panel => {
      const latest = weeks.filter((entry) => entry.sport === sport).at(-1) ?? null;
      return {
        id: `pull-${sport}`,
        title: `Pull ${sportLabel(sport)}`,
        hint: [
          latest ? `Last pulled ${latest.label}` : "Nothing pulled yet",
          remaining === null ? null : `${remaining} calls left`,
        ]
          .filter(Boolean)
          .join(" · "),
        body: (
          <>
            <GamesPullSection groupId={group.id} sport={sport} weeks={weeks} quota={quota} />
            {sport === "ncaaf" && (
              <RankingsSection groupId={group.id} weeks={weeks} poll={poll} />
            )}
            <TotalsPullSection
              groupId={group.id}
              sport={sport}
              weeks={weeks}
              week={week}
              games={games}
            />
          </>
        ),
      };
    }),
    {
      id: "weeks",
      title: "Week status",
      hint: [
        `${openWeeks.length} open`,
        `${weeks.filter((entry) => entry.closed_at && !entry.hidden_at).length} closed`,
        `${weeks.filter((entry) => entry.hidden_at).length} hidden`,
      ].join(" · "),
      body: <WeekStatusSection groupId={group.id} weeks={weeks} />,
    },
    {
      id: "picks",
      title: "Picks",
      hint: week
        ? `Corrections · ${sportLabel(week.sport)} ${week.label}, ${picks.length} picks`
        : "Corrections",
      aside:
        weeks.length > 0 && week ? (
          <WeekPicker groupId={group.id} weeks={weeks} week={week} />
        ) : null,
      body: <PicksSection groupId={group.id} members={members} games={games} picks={picks} />,
    },
    {
      id: "adjustments",
      title: "Points adjustments",
      hint: adjustments.length === 0 ? "None made" : `${adjustments.length} made`,
      body: (
        <AdjustmentsSection
          groupId={group.id}
          members={members}
          weeks={weeks}
          adjustments={adjustments}
        />
      ),
    },
    {
      id: "invite",
      title: "Invite someone",
      hint: `Join code ${group.join_code}`,
      body: (
        // Keyed by the code so regenerating it rewrites the message.
        <InviteMessage
          key={group.join_code}
          groupName={group.name}
          joinCode={group.join_code}
        />
      ),
    },
    {
      id: "members",
      title: "Members",
      hint: `${members.length} in the pool · ${members.filter((member) => member.is_admin).length} admin`,
      body: <MembersSection groupId={group.id} members={members} viewerId={viewerId} />,
    },
    {
      id: "group",
      title: "Join code",
      hint: "Regenerate, which stops the old one working",
      body: <GroupSection group={group} />,
    },
    {
      id: "log",
      title: "Audit log",
      hint: `${actions.length} recent action${actions.length === 1 ? "" : "s"}`,
      body: <AuditSection actions={actions} />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* The games page is where a week is actually run, so it is a door at
          the top rather than a drawer among ten others. */}
      <Link
        href={`/g/${group.id}/admin/games`}
        className="card flex items-center justify-between gap-3 px-4 py-3"
      >
        <span className="min-w-0">
          <span className="block font-semibold">Games</span>
          <span className="block truncate text-xs text-muted">
            {week
              ? `${sportLabel(week.sport)} ${week.label} · ${games.length} games` +
                (flagged > 0 ? ` · ${flagged} with an over/under` : "")
              : "Scores, kickoffs, over/unders, the slate"}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-muted">
          &rarr;
        </span>
      </Link>

      <SectionStack panels={panels} storageKey={`pickem:admin:${group.id}`} />
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
  const [state, action] = useFormState(setWeekStateAction, IDLE);
  const opened = weeks.filter((week) => week.opened_at !== null);

  const states: { value: WeekState; label: string; hint: string }[] = [
    { value: "open", label: "Open", hint: "Takes picks" },
    { value: "closed", label: "Closed", hint: "Finished, still readable" },
    { value: "hidden", label: "Hidden", hint: "Off the app, counts for nobody" },
  ];

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      <p className="text-sm text-muted">
        A week appears to members once its games are pulled. <strong>Open</strong>{" "}
        takes picks. <strong>Closed</strong> is finished and still there to read:
        the scores, the picks, who took what. <strong>Hidden</strong> is off the
        app entirely, with no column on the leaderboard and its points counting
        for nobody. All three can be undone.
      </p>

      {opened.length === 0 ? (
        <p className="text-sm text-muted">No weeks opened yet.</p>
      ) : (
        <ul className="space-y-2">
          {[...opened].reverse().map((week) => {
            const current = weekState(week);
            return (
              <li key={week.id} className="rounded-lg border border-edge p-3">
                <p className="mb-2 text-sm font-medium">
                  <span className="mr-2 rounded bg-edge px-1.5 py-0.5 text-xs font-semibold">
                    {sportLabel(week.sport)}
                  </span>
                  {weekChoiceLabel(week)}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {states.map((option) => {
                    const active = option.value === current;
                    return (
                      <form key={option.value} action={action}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="weekId" value={week.id} />
                        <input type="hidden" name="state" value={option.value} />
                        <SubmitButton
                          className={`btn py-1 text-sm ${
                            active ? "border-accent text-ink" : "text-muted"
                          }`}
                          pendingLabel="Saving..."
                        >
                          {option.label}
                        </SubmitButton>
                      </form>
                    );
                  })}
                </div>

                <p className="mt-1.5 text-xs text-muted">
                  {states.find((option) => option.value === current)?.hint}
                </p>
              </li>
            );
          })}
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
/** What the odds feed has left this month, said plainly. */
function QuotaLine({ quota }: { quota: Props["quota"] }) {
  if (!quota || quota.remaining === null) {
    return (
      <p className="text-xs text-muted">
        No balance recorded yet. It appears after the first call this deployment
        makes.
      </p>
    );
  }

  const allowance = quota.used === null ? null : quota.used + quota.remaining;
  const low = quota.remaining < 50;

  return (
    <p className={`text-xs ${low ? "text-[rgb(var(--loss))]" : "text-muted"}`}>
      <strong className={low ? "" : "text-ink"}>{quota.remaining}</strong>
      {allowance === null ? " calls" : ` of your ${allowance} calls`} left as of the
      last one spent. A pull spends one.{" "}
      {low && "Running low: use Claude below, or add games by hand."}
    </p>
  );
}

function GamesPullSection({
  groupId,
  sport,
  weeks,
  quota,
}: {
  groupId: string;
  sport: Sport;
  weeks: Week[];
  quota: Props["quota"];
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
          ? `Offers ${config.poolSize} games from across the week to choose from: ranked teams and close lines in equal measure, not one or the other.`
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
            <option value="feed">The odds feed &mdash; one call, exact names</option>
            <option value="claude">Claude web search &mdash; no feed calls, costs tokens</option>
          </select>
          <p className="mt-1 text-xs text-muted">
            Claude web search reads betting pages into its context, which runs to
            hundreds of thousands of tokens. It stops itself at a budget. Use it
            only when the feed has no games for the week.
          </p>
          <div className="mt-1">
            <QuotaLine quota={quota} />
          </div>
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

/**
 * The AP Top 25 for a college week, stored once and read for nothing.
 *
 * This used to be fetched by a model on every single pull, which is what made
 * an NCAA pull slow and expensive next to an instant, free NFL one. Pasting a
 * poll in costs nothing at all; the fetch button is one bounded search for
 * when pasting is inconvenient.
 */
function RankingsSection({
  groupId,
  weeks,
  poll,
}: {
  groupId: string;
  weeks: Week[];
  poll: Props["poll"];
}) {
  const [saveState, save] = useFormState(savePollAction, IDLE);
  const [fetchState, fetchPoll] = useFormState(fetchPollAction, IDLE);
  const latest = weeks.filter((week) => week.sport === "ncaaf").at(-1) ?? null;

  const seasonYear = latest?.season_year ?? new Date().getUTCFullYear();
  const weekNumber = latest?.week_number ?? 1;
  const stored =
    poll && poll.seasonYear === seasonYear && poll.weekNumber === weekNumber ? poll : null;

  return (
    <div className="mt-6 space-y-3 border-t border-edge pt-4">
      <h3 className="text-sm font-semibold">Rankings</h3>
      <Feedback state={saveState} />
      <Feedback state={fetchState} />
      <p className="text-sm text-muted">
        The odds feed carries no poll, so rankings are stored here, once a week.
        A pull then shows them for nothing. Without one, a pull still works and
        simply shows no rankings.
      </p>
      <p className="text-sm">
        {stored
          ? `Week ${weekNumber} has ${stored.ranked} ranked teams stored (${stored.source}).`
          : `Nothing stored for week ${weekNumber} yet.`}
      </p>

      <form action={save} className="space-y-2">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="seasonYear" value={seasonYear} />
        <input type="hidden" name="weekNumber" value={weekNumber} />
        <label className="label">Paste the Top 25 (free)</label>
        <textarea
          name="poll"
          rows={4}
          placeholder={"1. Ohio State\n2. Texas A&M\n3. Georgia"}
          className="field font-mono text-sm"
        />
        <p className="text-xs text-muted">
          Copy it from anywhere. Each line needs a number and a school; records,
          vote totals and brackets are ignored.
        </p>
        <SubmitButton className="btn" pendingLabel="Saving...">
          Save rankings
        </SubmitButton>
      </form>

      <form action={fetchPoll} className="border-t border-edge pt-3">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="seasonYear" value={seasonYear} />
        <input type="hidden" name="weekNumber" value={weekNumber} />
        <SubmitButton className="btn py-1 text-sm" pendingLabel="Reading...">
          Or read them from ncaa.com
        </SubmitButton>
        <p className="mt-1 text-xs text-muted">
          One request to the AP rankings page, parsed here. No model, no tokens.
          Set AP_POLL_URL to read a different page.
        </p>
      </form>
    </div>
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

/**
 * Pull scores, or refresh spreads, for one named week.
 *
 * The old single button did both for every open week at once, which is the
 * wrong shape for the thing people actually want: a score that has not landed
 * yet, in the game they are watching. Each button here spends one call against
 * the monthly allowance, on the week you chose and nothing else.
 */
function UpdateSection({
  groupId,
  weeks,
  quota,
}: {
  groupId: string;
  weeks: Week[];
  quota: Props["quota"];
}) {
  const [scoreState, pullScores] = useFormState(syncScoresAction, IDLE);
  const [oddsState, pullOdds] = useFormState(syncOddsAction, IDLE);
  const [pageState, pullFromPage] = useFormState(scrapeScoresAction, IDLE);

  // Only a week that is open can receive anything, so only those are offered.
  const open = weeks.filter((week) => week.opened_at && !week.closed_at);
  const [weekId, setWeekId] = useState(() => open.at(-1)?.id ?? "");

  if (open.length === 0) {
    return (
      <p className="text-sm text-muted">
        No week is open. Pull a week&apos;s games above, and this is where you
        chase its scores afterwards.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Feedback state={scoreState} />
      <Feedback state={oddsState} />
      <Feedback state={pageState} />
      <p className="text-sm text-muted">
        Scores update on their own every half hour while games are on. These are
        for when you would rather not wait, or a line moved and you want it now.
        Each button spends one call.
      </p>

      <div>
        <label className="label">Week</label>
        <select
          value={weekId}
          onChange={(event) => setWeekId(event.target.value)}
          className="field"
        >
          {[...open].reverse().map((week) => (
            <option key={week.id} value={week.id}>
              {sportLabel(week.sport)} · {weekChoiceLabel(week)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={pullScores}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="weekId" value={weekId} />
          <SubmitButton className="btn-primary" pendingLabel="Pulling...">
            Pull scores
          </SubmitButton>
        </form>

        <form action={pullOdds}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="weekId" value={weekId} />
          <SubmitButton className="btn" pendingLabel="Updating...">
            Update odds
          </SubmitButton>
        </form>

        <form action={pullFromPage}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="weekId" value={weekId} />
          <SubmitButton className="btn" pendingLabel="Reading...">
            Scores from page
          </SubmitButton>
        </form>
      </div>

      <QuotaLine quota={quota} />
      <p className="text-xs text-muted">
        Pull scores also freezes any line whose kickoff has passed and regrades
        what resolved. Update odds moves loose spreads and brings flexed kickoffs
        current; a locked line keeps its number. Scores from page reads the
        scoreboard page set in NCAAF_SCORES_URL, NFL_SCORES_URL or SCORES_URL,
        spends no call at all, and names every game it could not read.
      </p>
    </div>
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
