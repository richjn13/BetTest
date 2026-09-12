import type { GameCard, Side } from "./types";

/**
 * The picks a board holds while you tap around, kept separate from the
 * component so the reconciliation can be tested.
 *
 * The board owns its selections so a tap paints immediately. That means the
 * state has to be thrown away and rebuilt whenever the games underneath it
 * change -- switching weeks, most obviously. Carrying one week's picks into
 * another produces counts like "15 of 14" and games that claim you never
 * picked them.
 */
export type Selection = { side: Side | null; isLock: boolean };
export type Selections = Record<string, Selection>;

export function initialSelections(cards: GameCard[]): Selections {
  return Object.fromEntries(
    cards.map((card) => [
      card.game.id,
      {
        // The board's own pick is always a spread pick; totals are separate.
        side: (card.pick?.picked_side as Side | undefined) ?? null,
        isLock: card.pick?.is_lock ?? false,
      },
    ]),
  );
}

/** A stable identity for a set of games, used to notice when it changes. */
export function gameSetKey(cards: GameCard[]): string {
  return cards
    .map((card) => card.game.id)
    .sort()
    .join(",");
}

/** How many games have a side chosen. */
export function countPicked(selections: Selections): number {
  return Object.values(selections).filter((entry) => entry.side !== null).length;
}

/** Moves the week's single lock onto one game, or takes it off. */
export function withLockOn(
  selections: Selections,
  gameId: string,
  locked: boolean,
): Selections {
  const next: Selections = {};
  for (const [id, value] of Object.entries(selections)) {
    next[id] = { ...value, isLock: locked && id === gameId };
  }
  // Locking a game you have not picked takes the home side, matching the server.
  if (locked && next[gameId] && next[gameId].side === null) {
    next[gameId] = { ...next[gameId], side: "home" };
  }
  return next;
}
