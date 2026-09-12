import { formatPoints } from "@/lib/format";
import { computeWeekStats, formatRecord, type StatGame, type StatPick } from "@/lib/week-stats";
import { effectiveSpread, type GameCard, type Side } from "@/lib/types";

/**
 * End-of-week readout, shown once every game in the week has a result. Your
 * total and record first, then how your picks split, then what the week's
 * results say about the lines going into the next one.
 */
export function WeekSummary({ cards, weekLabel }: { cards: GameCard[]; weekLabel: string }) {
  const games: StatGame[] = cards.map((card) => ({
    id: card.game.id,
    homeTeam: card.game.home_team,
    awayTeam: card.game.away_team,
    spread: effectiveSpread(card.game),
    homeScore: card.game.final_home_score,
    awayScore: card.game.final_away_score,
    status: card.game.status,
  }));

  const picks: StatPick[] = cards
    .filter((card) => card.pick !== null)
    .map((card) => ({
      gameId: card.game.id,
      side: card.pick!.picked_side as Side,
      isLock: card.pick!.is_lock,
      points: card.pick!.points_awarded === null ? null : Number(card.pick!.points_awarded),
    }));

  const stats = computeWeekStats(games, picks);
  if (!stats.complete) return null;

  const lockText = {
    hit: "Lock hit",
    missed: "Lock missed",
    push: "Lock pushed",
    none: "No lock set",
  }[stats.lock];

  return (
    <section className="card mb-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge p-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {weekLabel} final
          </h2>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{formatRecord(stats.record)}</span> against the
            spread
            <span aria-hidden> · </span>
            <span
              className={
                stats.lock === "hit"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted"
              }
            >
              {lockText}
            </span>
          </p>
        </div>
        <p className="text-right">
          <span className="block font-mono text-3xl font-semibold leading-none tabular-nums">
            {formatPoints(stats.points)}
          </span>
          <span className="text-xs text-muted">points this week</span>
        </p>
      </div>

      {stats.splits.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-edge p-4 text-sm sm:grid-cols-4">
          {stats.splits.map((split) => (
            <div key={split.label}>
              <dt className="text-xs text-muted">{split.label}</dt>
              <dd className="font-mono tabular-nums">{formatRecord(split.record)}</dd>
            </div>
          ))}
        </dl>
      )}

      {stats.trends.length > 0 && (
        <div className="p-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Going into next week
          </h3>
          <ul className="space-y-1 text-sm">
            {stats.trends.map((trend) => (
              <li key={trend} className="flex gap-2">
                <span aria-hidden className="text-muted">
                  &middot;
                </span>
                <span>{trend}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
