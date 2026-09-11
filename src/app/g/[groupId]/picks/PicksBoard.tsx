"use client";

import { useCallback, useState, useTransition } from "react";
import { formatKickoff, spreadForSide, timeUntil } from "@/lib/format";
import { describeOutcome } from "@/lib/result";
import { abbreviate, nickname } from "@/lib/teams";
import { effectiveSpread, type GameCard, type Side } from "@/lib/types";
import { pickAction } from "./actions";

type Selection = { side: Side | null; isLock: boolean };

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
}: {
  cards: GameCard[];
  groupId: string;
  weekLabel: string;
  readOnly: boolean;
}) {
  const [selections, setSelections] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(
      cards.map((card) => [
        card.game.id,
        { side: card.pick?.picked_side ?? null, isLock: card.pick?.is_lock ?? false },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

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

  const toggleLock = (gameId: string) => {
    const previous = selections;
    const wasLocked = selections[gameId]?.isLock ?? false;

    setSelections((current) => {
      const next: Record<string, Selection> = {};
      for (const [id, value] of Object.entries(current)) {
        // Only one lock a week, so taking it moves it off wherever it was.
        next[id] = { ...value, isLock: id === gameId ? !wasLocked : false };
      }
      if (!wasLocked && next[gameId].side === null) next[gameId].side = "home";
      return next;
    });

    save(gameId, wasLocked ? "unlock" : "lock", previous);
  };

  const picked = Object.values(selections).filter((entry) => entry.side !== null).length;
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
            onChoose={(side) => choose(card.game.id, side)}
            onToggleLock={() => toggleLock(card.game.id)}
          />
        ))}
      </ul>

      <p className="pt-1 text-xs leading-relaxed text-muted">
        Picks stay changeable until each game kicks off, one game at a time.
        Everyone else&apos;s picks appear once a game starts.
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
  onChoose,
  onToggleLock,
}: {
  card: GameCard;
  selection: Selection;
  saving: boolean;
  error?: string;
  readOnly: boolean;
  onChoose: (side: Side) => void;
  onToggleLock: () => void;
}) {
  const { game, revealed } = card;
  const open = card.isOpen && !readOnly;
  const spread = effectiveSpread(game);
  const countdown = timeUntil(game.kickoff_time);

  const outcome = describeOutcome({
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

  const verdictTone =
    outcome.verdict === "win"
      ? "text-emerald-600 dark:text-emerald-400"
      : outcome.verdict === "push"
        ? "text-muted"
        : outcome.verdict === "loss"
          ? "text-muted"
          : "text-muted";

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 text-xs">
        <span className="truncate text-muted">
          {formatKickoff(game.kickoff_time)}
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
            spread={spread}
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

      {outcome.line && (
        <div className="border-t border-edge bg-surface/60 px-3 py-2.5 text-xs">
          <p className="font-medium">{outcome.line}</p>
          {outcome.effect && <p className={`mt-0.5 ${verdictTone}`}>{outcome.effect}</p>}
        </div>
      )}

      {revealed && revealed.length > 0 && (
        <p className="border-t border-edge px-3 py-2 text-xs text-muted">
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

      {error && (
        <p role="alert" className="border-t border-edge px-3 py-2 text-xs text-red-500">
          {error}
        </p>
      )}
    </li>
  );
}

function SideButton({
  side,
  game,
  spread,
  selected,
  covered,
  open,
  onChoose,
}: {
  side: Side;
  game: GameCard["game"];
  spread: number | null;
  selected: boolean;
  covered: boolean;
  open: boolean;
  onChoose: () => void;
}) {
  const team = side === "home" ? game.home_team : game.away_team;
  const opponent = side === "home" ? game.away_team : game.home_team;
  const score = side === "home" ? game.final_home_score : game.final_away_score;

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
              ? "border-emerald-500/40 bg-emerald-500/[0.06]"
              : "border-edge"
        } ${open ? "hover:border-accent active:scale-[0.99]" : ""}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">
          {nickname(team)}
        </span>
        <span className="block text-[11px] text-muted">
          {side === "away" ? "at " : "vs "}
          {abbreviate(opponent)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm tabular-nums">
          {spreadForSide(spread, side)}
        </span>
        {score !== null && (
          <span className="block font-mono text-base font-semibold tabular-nums">{score}</span>
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
      return <span className={`${pill} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`}>Final</span>;
    }
    return <span className={`${pill} bg-edge text-muted`}>Final</span>;
  }
  if (!isOpen) {
    return <span className={`${pill} bg-[rgb(var(--lock))]/15 text-[rgb(var(--lock))]`}>Locked</span>;
  }
  return <span className={`${pill} bg-accent/10 text-accent`}>Open</span>;
}
