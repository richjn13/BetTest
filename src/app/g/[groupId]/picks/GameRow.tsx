"use client";

import { useFormState } from "react-dom";
import { useFormStatus } from "react-dom";
import { abbreviate, nickname } from "@/lib/teams";
import { formatKickoff, spreadForSide, timeUntil } from "@/lib/format";
import { winningSide } from "@/lib/scoring";
import { effectiveSpread, type GameCard, type Side } from "@/lib/types";
import { pickAction, type PickState } from "./actions";

const EMPTY: PickState = { error: null };

export function GameRow({ card, groupId }: { card: GameCard; groupId: string }) {
  const [state, action] = useFormState(pickAction, EMPTY);
  const { game, pick, isOpen, revealed } = card;
  const spread = effectiveSpread(game);
  const countdown = timeUntil(game.kickoff_time);

  return (
    <li className="card p-3">
      <form action={action}>
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="gameId" value={game.id} />

        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">
            {formatKickoff(game.kickoff_time)}
            {countdown ? ` · in ${countdown}` : ""}
          </span>
          <StatusBadge card={card} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SideButton side="away" card={card} spread={spread} />
          <SideButton side="home" card={card} spread={spread} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <LockButton card={card} />
          {!isOpen && !pick && (
            <span className="text-xs text-muted">No pick made</span>
          )}
        </div>

        {state.error && (
          <p role="alert" className="mt-2 text-xs text-red-500">
            {state.error}
          </p>
        )}
      </form>

      {revealed && revealed.length > 0 && (
        <p className="mt-2 border-t border-edge pt-2 text-xs text-muted">
          {revealed.map((entry, index) => (
            <span key={entry.username}>
              {index > 0 && " · "}
              {entry.username}{" "}
              <span className="font-medium text-ink">
                {abbreviate(entry.side === "home" ? game.home_team : game.away_team)}
              </span>
              {entry.isLock && " 🔒"}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

function SideButton({
  side,
  card,
  spread,
}: {
  side: Side;
  card: GameCard;
  spread: number | null;
}) {
  const { pending } = useFormStatus();
  const { game, pick, isOpen } = card;
  const team = side === "home" ? game.home_team : game.away_team;
  const selected = pick?.picked_side === side;
  const score = side === "home" ? game.final_home_score : game.final_away_score;

  return (
    <button
      type="submit"
      name="intent"
      value={side}
      disabled={!isOpen || pending}
      aria-pressed={selected}
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left
        transition-colors disabled:cursor-default ${
          selected
            ? "border-accent bg-accent/10"
            : "border-edge hover:border-accent disabled:hover:border-edge"
        }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{nickname(team)}</span>
        <span className="text-xs text-muted">
          {side === "away" ? "at " : "vs "}
          {abbreviate(side === "home" ? game.away_team : game.home_team)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm">{spreadForSide(spread, side)}</span>
        {score !== null && <span className="block text-xs text-muted">{score}</span>}
      </span>
    </button>
  );
}

function LockButton({ card }: { card: GameCard }) {
  const { pending } = useFormStatus();
  const { pick, isOpen } = card;
  const isLock = pick?.is_lock ?? false;

  if (!isOpen) {
    return isLock ? (
      <span className="text-xs font-medium text-amber-500">🔒 Lock · double points</span>
    ) : (
      <span />
    );
  }

  return (
    <button
      type="submit"
      name="intent"
      value={isLock ? "unlock" : "lock"}
      disabled={pending}
      aria-pressed={isLock}
      className={`btn px-2 py-1 text-xs ${
        isLock ? "border-amber-500 text-amber-500" : "text-muted hover:text-ink"
      }`}
    >
      {isLock ? "🔒 Lock of the week" : "Make this my lock"}
    </button>
  );
}

function StatusBadge({ card }: { card: GameCard }) {
  const { game, pick, isOpen } = card;

  if (game.status === "postponed" || game.status === "canceled") {
    return <span className="text-muted">{game.status} · not scored</span>;
  }

  if (game.status === "final") {
    if (!pick) return <span className="text-muted">Final</span>;

    const points = pick.points_awarded === null ? null : Number(pick.points_awarded);
    if (points === null) return <span className="text-muted">Final · scoring</span>;
    if (points > 0) {
      return <span className="font-medium text-emerald-500">Final · +{points}</span>;
    }

    const outcome = winningSide({
      status: game.status,
      finalHomeScore: game.final_home_score,
      finalAwayScore: game.final_away_score,
      frozenHomeSpread: game.spread_frozen_at ? game.frozen_home_spread : game.home_spread,
    });
    if (outcome === "push") return <span className="text-muted">Final · push</span>;
    return <span className="text-muted">Final · missed</span>;
  }

  if (!isOpen) return <span className="font-medium text-amber-500">LOCKED</span>;
  return <span className="text-muted">Open</span>;
}
