"use client";

import { useCallback, useState, useTransition } from "react";
import { formatKickoff, spreadForSide, timeUntil } from "@/lib/format";
import { consensusVerdict, describeOutcome } from "@/lib/result";
import { abbreviate, nickname, splitTeamName } from "@/lib/teams";
import type { Sport } from "@/lib/sports";
import {
  countPicked,
  gameSetKey,
  initialSelections,
  withLockOn,
  type Selection,
  type Selections,
} from "@/lib/selections";
import {
  effectiveSpread,
  effectiveTotal,
  type GameCard,
  type Side,
  type TotalSide,
} from "@/lib/types";
import { pickAction } from "./actions";

/**
 * Owns the week's picks so a tap lands immediately.
 *
 * The click updates local state first and saves in the background. A rejected
 * save restores what was there before and says why, so the screen never keeps
 * a pick the server refused.
 */
export function PicksBoard({
  cards,
  groupId,
  weekLabel,
  readOnly,
  sport,
}: {
  cards: GameCard[];
  groupId: string;
  weekLabel: string;
  readOnly: boolean;
  sport: Sport;
}) {
  const [selections, setSelections] = useState<Selections>(() => initialSelections(cards));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  // Rebuild from scratch when the games change underneath. The page also keys
  // this component by week, so normally it remounts; this covers the case
  // where React reuses it anyway, which is what produced counts like
  // "15 of 14" and finished games claiming they were never picked.
  const key = gameSetKey(cards);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setSelections(initialSelections(cards));
    setErrors({});
    setSaving({});
  }

  const save = useCallback(
    (gameId: string, intent: string, revert: Record<string, Selection>) => {
      setSaving((current) => ({ ...current, [gameId]: true }));
      setErrors((current) => {
        const { [gameId]: _removed, ...rest } = current;
        return rest;
      });

      startTransition(async () => {
        const form = new FormData();
        form.set("groupId", groupId);
        form.set("gameId", gameId);
        form.set("intent", intent);

        const result = await pickAction({ error: null }, form);
        setSaving((current) => ({ ...current, [gameId]: false }));
        if (result.error) {
          setSelections(revert);
          setErrors((current) => ({ ...current, [gameId]: result.error as string }));
        }
      });
    },
    [groupId],
  );

  const choose = (gameId: string, side: Side) => {
    const previous = selections;
    setSelections((current) => ({
      ...current,
      [gameId]: { ...current[gameId], side },
    }));
    save(gameId, side, previous);
  };

  const pickTotal = (gameId: string, side: TotalSide) => {
    const previous = selections;
    setSelections((current) => ({
      ...current,
      [gameId]: { ...current[gameId], total: side },
    }));
    save(gameId, side, previous);
  };

  const toggleLock = (gameId: string) => {
    const previous = selections;
    const wasLocked = selections[gameId]?.isLock ?? false;

    // Only one lock a week, so taking it moves it off wherever it was.
    setSelections((current) => withLockOn(current, gameId, !wasLocked));

    save(gameId, wasLocked ? "unlock" : "lock", previous);
  };

  const picked = countPicked(selections);
  const lockedCard = cards.find((card) => selections[card.game.id]?.isLock);
  const lockTeam = lockedCard
    ? abbreviate(
        selections[lockedCard.game.id].side === "home"
          ? lockedCard.game.home_team
          : lockedCard.game.away_team,
      )
    : null;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{weekLabel}</h2>
        <p className="text-sm text-muted">
          <span className="tabular-nums">
            {picked} of {cards.length}
          </span>{" "}
          picked
          <span aria-hidden> · </span>
          {lockTeam ? (
            <span className="font-medium text-[rgb(var(--lock))]">lock on {lockTeam}</span>
          ) : (
            "no lock set"
          )}
        </p>
      </header>

      <ul className="space-y-2">
        {cards.map((card) => (
          <GameRow
            key={card.game.id}
            card={card}
            selection={selections[card.game.id]}
            saving={saving[card.game.id] ?? false}
            error={errors[card.game.id]}
            readOnly={readOnly}
            sport={sport}
            onChoose={(side) => choose(card.game.id, side)}
            onPickTotal={(side) => pickTotal(card.game.id, side)}
            onToggleLock={() => toggleLock(card.game.id)}
          />
        ))}
      </ul>

      <p className="pt-1 text-xs leading-relaxed text-muted">
        {readOnly
          ? "This week is finished. Every pick is shown as it was made."
          : "Picks stay changeable until each game kicks off, one game at a time. Everyone else's picks appear once a game starts."}
      </p>
    </section>
  );
}

function GameRow({
  card,
  selection,
  saving,
  error,
  readOnly,
  sport,
  onChoose,
  onPickTotal,
  onToggleLock,
}: {
  card: GameCard;
  selection: Selection;
  saving: boolean;
  error?: string;
  readOnly: boolean;
  sport: Sport;
  onChoose: (side: Side) => void;
  onPickTotal: (side: TotalSide) => void;
  onToggleLock: () => void;
}) {
  const { game } = card;
  const open = card.isOpen && !readOnly;
  const spread = effectiveSpread(game);
  const countdown = timeUntil(game.kickoff_time);

  const outcome = describeOutcome({
    sport,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    finalHomeScore: game.final_home_score,
    finalAwayScore: game.final_away_score,
    spread,
    status: game.status,
    pickedSide: selection?.side ?? null,
    isLock: selection?.isLock ?? false,
    points: card.pick?.points_awarded === null ? null : Number(card.pick?.points_awarded),
  });

  // A settled game reads at a glance from the card's left edge: green for a
  // win, red for a loss, neutral for a push or a game you sat out.
  const edge =
    outcome.verdict === "win"
      ? "border-l-4 border-l-[rgb(var(--win))]"
      : outcome.verdict === "loss"
        ? "border-l-4 border-l-[rgb(var(--loss))]"
        : outcome.verdict === "push"
          ? "border-l-4 border-l-edge"
          : "";

  const verdictTone =
    outcome.verdict === "win"
      ? "font-medium text-[rgb(var(--win))]"
      : outcome.verdict === "loss"
        ? "text-[rgb(var(--loss))]"
        : "text-muted";

  // Flex scheduling moved this one after it was first listed.
  const moved =
    game.kickoff_changed_at !== null && new Date(game.kickoff_time).getTime() > Date.now();

  return (
    <li className={`card overflow-hidden ${edge}`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 text-xs">
        <span className="truncate text-muted">
          {moved && (
            <span className="mr-1.5 font-semibold text-[rgb(var(--loss))]">
              Time changed
            </span>
          )}
          <span className={moved ? "font-medium text-[rgb(var(--loss))]" : undefined}>
            {formatKickoff(game.kickoff_time)}
          </span>
          {countdown && <span className="hidden sm:inline"> · in {countdown}</span>}
        </span>
        <StatusPill card={card} verdict={outcome.verdict} saving={saving} />
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 pt-2">
        {(["away", "home"] as const).map((side) => (
          <SideButton
            key={side}
            side={side}
            game={game}
            // The line stays on screen once a game is under way and after it
            // ends. It is the number the pick was graded against, so with a
            // score beside it the card explains itself.
            spread={spread}
            sport={sport}
            selected={selection?.side === side}
            covered={outcome.covered === side}
            open={open}
            onChoose={() => onChoose(side)}
          />
        ))}
      </div>

      {(open || selection?.isLock) && (
        <div className="px-3 pb-3">
          {open ? (
            <button
              type="button"
              onClick={onToggleLock}
              aria-pressed={selection?.isLock ?? false}
              className={`min-h-[36px] w-full rounded-lg border px-3 text-xs font-medium
                transition-colors ${
                  selection?.isLock
                    ? "border-[rgb(var(--lock))] bg-[rgb(var(--lock))]/10 text-[rgb(var(--lock))]"
                    : "border-edge text-muted hover:border-[rgb(var(--lock))] hover:text-[rgb(var(--lock))]"
                }`}
            >
              {selection?.isLock ? "★ Lock of the week · double points" : "Make this my lock"}
            </button>
          ) : (
            <p className="text-xs font-medium text-[rgb(var(--lock))]">
              ★ Lock · double points
            </p>
          )}
        </div>
      )}

      <TotalRow
        card={card}
        open={open}
        chosen={selection?.total ?? null}
        onPick={onPickTotal}
      />

      {outcome.line && (
        <div className="border-t border-edge bg-surface/60 px-3 py-2.5 text-xs">
          <p className="font-medium">{outcome.line}</p>
          {outcome.effect && <p className={`mt-0.5 ${verdictTone}`}>{outcome.effect}</p>}
        </div>
      )}

      <Consensus card={card} outcome={outcome} sport={sport} />

      {error && (
        <p role="alert" className="border-t border-edge px-3 py-2 text-xs text-red-500">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * How the group split on this game, and once it is decided, how many of them
 * got it right. Only ever shown after kickoff, so it cannot help anyone copy.
 */
function Consensus({
  card,
  outcome,
  sport,
}: {
  card: GameCard;
  outcome: ReturnType<typeof describeOutcome>;
  sport: Sport;
}) {
  const { game, consensus, revealed } = card;
  if (!consensus || consensus.total === 0) return null;

  // A three-letter college abbreviation is made from the mascot and means
  // nothing: Indiana Hoosiers becomes HOO. The school reads at any width.
  const short = (team: string) =>
    sport === "ncaaf" ? splitTeamName(team).school : abbreviate(team);
  const homeAbbr = short(game.home_team);
  const awayAbbr = short(game.away_team);

  const result = consensusVerdict(consensus, outcome.covered);
  const verdict =
    result === null
      ? null
      : result === "push"
        ? "Push, so nobody scored."
        : `${result.right} of ${result.total} right · ${result.percent}%`;

  return (
    <div className="border-t border-edge px-3 py-2 text-xs">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-muted">
          <span className="font-medium text-ink">{awayAbbr}</span> {consensus.away}
          <span aria-hidden className="mx-1.5">
            &middot;
          </span>
          <span className="font-medium text-ink">{homeAbbr}</span> {consensus.home}
        </span>
        {verdict && (
          <span
            className={
              result === "push" ? "text-muted" : "font-medium tabular-nums"
            }
          >
            {verdict}
          </span>
        )}
      </p>

      {revealed && revealed.length > 0 && (
        <p className="mt-1 text-muted">
          {revealed.map((entry, index) => (
            <span key={entry.username}>
              {index > 0 && " · "}
              {entry.username}{" "}
              <span className="font-medium text-ink">
                {abbreviate(entry.side === "home" ? game.home_team : game.away_team)}
              </span>
              {entry.isLock && " ★"}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Over/under. Absent entirely unless an admin turned it on for this game, so
 * a pool that never uses totals never sees a trace of them.
 */
function TotalRow({
  card,
  open,
  chosen,
  onPick,
}: {
  card: GameCard;
  open: boolean;
  /** From the board's own state, so a tap paints before the server answers. */
  chosen: TotalSide | null;
  onPick: (side: TotalSide) => void;
}) {
  const { game, totalPick } = card;
  if (!game.totals_enabled) return null;

  const line = effectiveTotal(game);
  if (line === null) return null;

  const points = totalPick?.points_awarded === null ? null : Number(totalPick?.points_awarded);
  const combined =
    game.final_home_score !== null && game.final_away_score !== null
      ? game.final_home_score + game.final_away_score
      : null;

  return (
    <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
      <span className="shrink-0 text-xs text-muted">
        O/U <span className="font-mono text-ink">{line}</span>
        {combined !== null && (
          <span className="ml-1 font-mono text-ink">· {combined}</span>
        )}
      </span>
      <div className="ml-auto flex gap-1.5">
        {(["over", "under"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={open ? () => onPick(side) : undefined}
            disabled={!open}
            aria-pressed={chosen === side}
            className={`min-h-[32px] rounded-lg border px-3 text-xs font-medium capitalize
              transition-colors disabled:cursor-default ${
                chosen === side ? "border-accent bg-accent/10" : "border-edge text-muted"
              } ${open ? "hover:border-accent" : ""}`}
          >
            {side}
          </button>
        ))}
      </div>
      {points !== null && (
        <span
          className={`shrink-0 font-mono text-xs ${
            points > 0 ? "font-semibold text-[rgb(var(--win))]" : "text-muted"
          }`}
        >
          {points > 0 ? `+${points}` : "0"}
        </span>
      )}
    </div>
  );
}

function SideButton({
  side,
  game,
  spread,
  sport,
  selected,
  covered,
  open,
  onChoose,
}: {
  side: Side;
  game: GameCard["game"];
  spread: number | null;
  sport: Sport;
  selected: boolean;
  covered: boolean;
  open: boolean;
  onChoose: () => void;
}) {
  const team = side === "home" ? game.home_team : game.away_team;
  const opponent = side === "home" ? game.away_team : game.home_team;
  const score = side === "home" ? game.final_home_score : game.final_away_score;
  const rank = side === "home" ? game.home_rank : game.away_rank;
  // College is named by the school, not the mascot. A card reading "Bison at
  // Hoosiers" is unreadable to anyone who does not follow the sport, and there
  // are a dozen Bulldogs. The NFL is the other way round: everyone knows the
  // Chiefs, and the city is the part that repeats.
  const college = sport === "ncaaf";
  const split = splitTeamName(team);
  const headline = college ? split.school : nickname(team);
  const subtitle = college ? split.mascot : null;
  const versus = college ? splitTeamName(opponent).school : abbreviate(opponent);

  return (
    <button
      type="button"
      onClick={open ? onChoose : undefined}
      disabled={!open}
      aria-pressed={selected}
      className={`flex min-h-[56px] items-center justify-between gap-2 rounded-lg border
        px-3 py-2 text-left transition-colors disabled:cursor-default ${
          selected
            ? "border-accent bg-accent/10"
            : covered
              ? "border-[rgb(var(--win))]/40 bg-[rgb(var(--win))]/[0.06]"
              : "border-edge"
        } ${open ? "hover:border-accent active:scale-[0.99]" : ""}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">
          {rank !== null && (
            <span className="mr-1 font-mono text-xs font-bold text-accent">#{rank}</span>
          )}
          {headline}
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] leading-tight text-muted">
            {subtitle}
          </span>
        )}
        <span className="block truncate text-[11px] text-muted">
          {side === "away" ? "at " : "vs "}
          {versus}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {/* The line sits above the score, small and quiet, so a card with
            both on it still reads score-first. */}
        {spread !== null && (
          <span className="block font-mono text-[11px] leading-tight tabular-nums text-muted">
            {spreadForSide(spread, side)}
          </span>
        )}
        {score !== null && (
          <span
            className={`block font-mono text-lg font-semibold leading-tight tabular-nums ${
              covered ? "text-[rgb(var(--win))]" : "text-muted"
            }`}
          >
            {score}
          </span>
        )}
      </span>
    </button>
  );
}

function StatusPill({
  card,
  verdict,
  saving,
}: {
  card: GameCard;
  verdict: string;
  saving: boolean;
}) {
  if (saving) return <span className="text-muted">Saving...</span>;

  const { game, isOpen } = card;
  const pill = "rounded-full px-2 py-0.5 text-[11px] font-medium";

  if (game.status === "postponed" || game.status === "canceled") {
    return <span className={`${pill} bg-edge text-muted`}>{game.status}</span>;
  }
  if (game.status === "final") {
    if (verdict === "win") {
      return (
        <span className={`${pill} bg-[rgb(var(--win))]/15 text-[rgb(var(--win))]`}>
          Won
        </span>
      );
    }
    if (verdict === "loss") {
      return (
        <span className={`${pill} bg-[rgb(var(--loss))]/12 text-[rgb(var(--loss))]`}>
          Lost
        </span>
      );
    }
    if (verdict === "push") {
      return <span className={`${pill} bg-edge text-muted`}>Push</span>;
    }
    return <span className={`${pill} bg-edge text-muted`}>Final</span>;
  }
  if (!isOpen) {
    return <span className={`${pill} bg-[rgb(var(--lock))]/15 text-[rgb(var(--lock))]`}>Locked</span>;
  }
  return <span className={`${pill} bg-accent/10 text-accent`}>Open</span>;
}
