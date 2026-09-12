"use client";

import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { formatKickoff, spreadForSide, weekChoiceLabel } from "@/lib/format";
import { abbreviate, NFL_TEAMS } from "@/lib/teams";
import { SPORTS, sportConfig, sportLabel, type Sport } from "@/lib/sports";
import { effectiveSpread } from "@/lib/types";
import type { Game, Week } from "@/lib/types";
import { IDLE } from "./state";
import { Feedback, Section } from "./ui";
import {
  addGameAction,
  deleteGameAction,
  overrideGameAction,
  setGameInSlateAction,
  setTotalAction,
  toggleTotalAction,
} from "./actions";

/**
 * Everything about the games themselves: the slate, scores, kickoff times,
 * over/unders, and adding or deleting a game.
 *
 * This is its own page rather than a section of the admin panel because it is
 * the one part that changes constantly -- a Sunday of score corrections, a
 * flexed kickoff, an over/under toggled on -- and every one of those edits
 * reloads the page it sits on. Sharing that page with the pull buttons meant
 * every small correction rebuilt the pull forms too, and a mistyped score and
 * an accidental re-pull were two controls apart.
 */
export function GamesPanel({
  groupId,
  weeks,
  week,
  games,
}: {
  groupId: string;
  weeks: Week[];
  week: Week | null;
  games: Game[];
}) {
  const router = useRouter();
  const sport: Sport = week?.sport ?? "nfl";
  const go = (weekId: string) => router.push(`/g/${groupId}/admin/games?week=${weekId}`);

  // Weeks of the sport being looked at, newest first, so the one in play is
  // at the top of a list that grows all season.
  const forSport = weeks.filter((option) => option.sport === sport);

  return (
    <div className="space-y-4">
      <Section
        title="Which week"
        aside={
          <a href={`/g/${groupId}/admin`} className="text-sm text-accent hover:underline">
            Pulls and settings
          </a>
        }
      >
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((option) => {
            const first = weeks.filter((entry) => entry.sport === option).at(-1);
            const active = option === sport;
            return (
              <button
                key={option}
                type="button"
                disabled={!first}
                onClick={() => first && go(first.id)}
                aria-pressed={active}
                className={`btn py-1 text-sm ${
                  active ? "border-accent text-ink" : "text-muted"
                } disabled:opacity-40`}
              >
                {sportLabel(option)}
                {!first && " (no weeks yet)"}
              </button>
            );
          })}
        </div>

        {forSport.length > 0 && week && (
          <select
            value={week.id}
            onChange={(event) => go(event.target.value)}
            className="field mt-3"
            aria-label="Week"
          >
            {[...forSport].reverse().map((option) => (
              <option key={option.id} value={option.id}>
                {weekChoiceLabel(option)}
                {option.closed_at ? " · closed" : option.opened_at ? "" : " · not opened"}
              </option>
            ))}
          </select>
        )}
      </Section>

      <Section
        title={week ? `${sportLabel(week.sport)} ${weekChoiceLabel(week)}` : "Games"}
        aside={week ? <SlateCount sport={week.sport} games={games} /> : null}
      >
        <GamesSection groupId={groupId} week={week} games={games} weeks={weeks} />
      </Section>
    </div>
  );
}

/**
 * How many games the pool is actually playing this week, against the number
 * that makes a good week. The goal is a target, not a limit: a slate can be
 * eight or fourteen, and the count is there so the choice is deliberate.
 */
function SlateCount({ sport, games }: { sport: Sport; games: Game[] }) {
  const inSlate = games.filter((game) => game.excluded_at === null).length;
  const goal = sportConfig(sport).slateGoal;
  const met = goal !== null && inSlate >= goal;

  return (
    <span className="text-sm">
      <strong className={met ? "text-[rgb(var(--win))]" : "text-ink"}>{inSlate}</strong>
      <span className="text-muted">
        {goal === null
          ? ` game${inSlate === 1 ? "" : "s"} in the slate`
          : ` of ${goal} in the slate`}
        {games.length > inSlate && ` · ${games.length - inSlate} set aside`}
      </span>
    </span>
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
  const [totalState, setTotal] = useFormState(setTotalAction, IDLE);
  const [toggleState, toggleTotal] = useFormState(toggleTotalAction, IDLE);
  const [slateState, setInSlate] = useFormState(setGameInSlateAction, IDLE);

  const defaultYear = week?.season_year ?? new Date().getUTCFullYear();
  const defaultWeek = week?.week_number ?? 1;
  const defaultSport: Sport = week?.sport ?? "nfl";

  // The newest "seen in the feed" stamp in the week. A game older than it was
  // not mentioned by the last pull, so it has come off the slate. Worked out
  // once here rather than once per game inside the list.
  const newestSeen = games.reduce<string | null>(
    (latest, game) =>
      game.last_seen_in_feed_at && (!latest || game.last_seen_in_feed_at > latest)
        ? game.last_seen_in_feed_at
        : latest,
    null,
  );

  return (
    <div className="space-y-6">
      <details className="rounded-lg border border-edge px-3 py-2">
        <summary className="cursor-pointer list-none text-sm font-semibold">
          Add a game by hand
        </summary>
        <form action={addGame} className="mt-3 space-y-3">
          <input type="hidden" name="groupId" value={groupId} />
          <Feedback state={addState} />
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Competition</label>
              <select name="sport" defaultValue={defaultSport} className="field">
                {SPORTS.map((option) => (
                  <option key={option} value={option}>
                    {sportLabel(option)}
                  </option>
                ))}
              </select>
            </div>
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
              <label className="label">Week</label>
              <input
                name="weekNumber"
                type="number"
                min={0}
                max={22}
                defaultValue={defaultWeek}
                required
                className="field"
              />
            </div>
            <div>
              <label className="label">Away team</label>
              <TeamField name="awayTeam" />
            </div>
            <div>
              <label className="label">Home team</label>
              <TeamField name="homeTeam" />
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
            NFL names autocomplete; for college, type the name exactly as the
            odds feed writes it, nickname included, or scores will not attach.
          </p>
          <SubmitButton className="btn" pendingLabel="Adding...">
            Add game
          </SubmitButton>
        </form>
      </details>

      <div>
        <Feedback state={overrideState} />
        <Feedback state={deleteState} />
        <Feedback state={totalState} />
        <Feedback state={toggleState} />
        <Feedback state={slateState} />
        {games.length === 0 ? (
          <p className="text-sm text-muted">No games in this week yet.</p>
        ) : (
          <ul className="space-y-3">
            {games.map((game) => {
              const droppedOff =
                newestSeen !== null &&
                (game.last_seen_in_feed_at === null || game.last_seen_in_feed_at < newestSeen);

              return (
              <li
                key={game.id}
                className={`rounded-lg border p-3 ${
                  droppedOff ? "border-[rgb(var(--loss))]/50" : "border-edge"
                } ${game.excluded_at ? "opacity-60" : ""}`}
              >
                <form action={setInSlate} className="mb-2 flex items-center gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="gameId" value={game.id} />
                  <input
                    type="hidden"
                    name="inSlate"
                    value={game.excluded_at ? "true" : "false"}
                  />
                  <SubmitButton
                    className={`btn py-1 text-sm ${
                      game.excluded_at
                        ? "border-edge text-muted"
                        : "border-accent text-[rgb(var(--win))]"
                    }`}
                    pendingLabel="Saving..."
                  >
                    {game.excluded_at ? "Off" : "On"}
                  </SubmitButton>
                  <span className="text-xs text-muted">
                    {game.excluded_at
                      ? "Off. Members do not see this game."
                      : "On. In this week's slate."}
                  </span>
                </form>

                {droppedOff && (
                  <p className="mb-2 text-xs font-semibold text-[rgb(var(--loss))]">
                    Not in the latest pull. It may have come off the slate. Picks
                    on it still count until you delete it.
                  </p>
                )}
                {game.kickoff_changed_at && (
                  <p className="mb-2 text-xs font-medium text-[rgb(var(--loss))]">
                    Kickoff has moved since this game was first listed.
                  </p>
                )}
                <div className="mb-2 space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono font-semibold">
                      {abbreviate(game.away_team)}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted">away</span>
                    <span className="text-muted">{game.away_team}</span>
                  </p>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono font-semibold">
                      {abbreviate(game.home_team)}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted">home</span>
                    <span className="text-muted">{game.home_team}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {formatKickoff(game.kickoff_time)} ·{" "}
                    {spreadForSide(effectiveSpread(game), "home")}
                    {game.spread_frozen_at
                      ? " (frozen)"
                      : game.spread_locked_at
                        ? " (locked)"
                        : ""} · {game.status}
                    {game.score_overridden_at ? " · manual" : ""}
                  </p>
                </div>

                <form action={override} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
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
                    placeholder={`${abbreviate(game.away_team)} (away)`}
                    defaultValue={game.final_away_score ?? ""}
                    className="field py-1 text-sm"
                  />
                  <input
                    name="finalHomeScore"
                    type="number"
                    placeholder={`${abbreviate(game.home_team)} (home)`}
                    defaultValue={game.final_home_score ?? ""}
                    className="field py-1 text-sm"
                  />
                  <input
                    name="kickoffTime"
                    type="datetime-local"
                    aria-label="Move kickoff, leave blank to keep it"
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

                <p className="mt-2 text-xs text-muted">
                  The date box moves the kickoff, for a flexed game the feed has
                  not caught up with. Leave it blank to keep the current time.
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={toggleTotal}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="gameId" value={game.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={game.totals_enabled ? "false" : "true"}
                    />
                    <SubmitButton
                      className={`btn py-1 text-sm ${
                        game.totals_enabled ? "text-muted" : ""
                      }`}
                      pendingLabel="Saving..."
                    >
                      {game.totals_enabled ? "Over/under off" : "Over/under on"}
                    </SubmitButton>
                  </form>

                  {game.totals_enabled && (
                    <>
                      <span className="text-xs text-muted">
                        {game.total_points === null
                          ? "waiting on a number, pull totals from the admin page"
                          : `set at ${game.total_points}`}
                      </span>
                      <form action={setTotal} className="flex gap-2">
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="gameId" value={game.id} />
                        <input
                          name="total"
                          type="number"
                          step="0.5"
                          min={0}
                          max={150}
                          defaultValue={game.total_points ?? ""}
                          placeholder="by hand"
                          aria-label="Over/under total"
                          className="field w-24 py-1 text-sm"
                        />
                        <SubmitButton className="btn py-1 text-sm" pendingLabel="Saving...">
                          Set
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>


                {/*
                  Deleting takes every pick on the game with it, and setting a
                  game aside does what deleting was being used for. So it is
                  folded away: reachable for a game that should never have
                  existed, not sitting under every row inviting a tap.
                */}
                <details className="mt-2">
                  <summary className="cursor-pointer list-none text-xs text-muted">
                    Remove permanently
                  </summary>
                  <p className="mb-2 mt-2 text-xs text-muted">
                    This deletes the game and every pick on it, and cannot be
                    undone. To take a game out of the week, set it aside above
                    instead: it keeps its line and can come back.
                  </p>
                  <form action={remove} className="flex gap-2">
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
                      Delete
                    </SubmitButton>
                  </form>
                </details>
              </li>
              );
            })}
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

/**
 * A free-text team name with the thirty-two NFL names offered as suggestions.
 * College has hundreds of schools whose names change, so a closed list would
 * make half the app unusable; this keeps NFL entry a single tap without
 * shutting college out.
 */
function TeamField({ name }: { name: string }) {
  return (
    <>
      <input
        name={name}
        list="nfl-team-names"
        required
        autoComplete="off"
        placeholder="Team name"
        className="field"
      />
      <datalist id="nfl-team-names">
        {NFL_TEAMS.map((team) => (
          <option key={team} value={team} />
        ))}
      </datalist>
    </>
  );
}
