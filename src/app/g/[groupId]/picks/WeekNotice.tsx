import type { GameCard, Week } from "@/lib/types";

/**
 * One line at the top of a week saying where it stands, so nobody has to infer
 * it from the state of the cards below.
 */
export function WeekNotice({ week, cards }: { week: Week; cards: GameCard[] }) {
  if (cards.length === 0) return null;

  const now = Date.now();
  const started = cards.filter(
    (card) => new Date(card.game.kickoff_time).getTime() <= now,
  ).length;

  let tone = "text-muted";
  let message: string;

  if (week.closed_at) {
    // A finished week stays here to be read. Say so plainly, so nobody wonders
    // why the buttons have gone.
    message = `${week.label} is finished. This is how it ended; nothing here can change.`;
  } else if (started === 0) {
    // Lines are pulled by hand each week, so say when that happens rather than
    // leaving people wondering whether a number is stale.
    message = `Lines are updated every Tuesday. Pick any time before each kickoff.`;
    tone = "text-muted";
  } else if (started < cards.length) {
    const remaining = cards.length - started;
    message = `${remaining} game${remaining === 1 ? "" : "s"} still open. Scores update through the day.`;
  } else {
    message = "Every game has kicked off. Scores update until they are final.";
  }

  return (
    <p
      className={`mb-3 rounded-lg border border-edge bg-raised px-3 py-2 text-xs ${tone}`}
      role="status"
    >
      {message}
    </p>
  );
}
