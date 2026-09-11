import { winningSide, type GameStatus, type Side } from "./scoring";

/**
 * The end-of-week readout: how you did, and what the week's results say about
 * the lines going into the next one. Pure, so the arithmetic can be tested.
 */

export type StatGame = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  /** From the home team's perspective. Negative means home favoured. */
  spread: number | null;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
};

export type StatPick = { gameId: string; side: Side; isLock: boolean; points: number | null };

export type Record = { wins: number; losses: number; pushes: number };

export type WeekStats = {
  /** True once every game has a result or has been excluded. */
  complete: boolean;
  gamesGraded: number;
  gamesTotal: number;
  points: number;
  record: Record;
  lock: "hit" | "missed" | "push" | "none";
  /** How your own picks split by the kind of side you took. */
  splits: { label: string; record: Record }[];
  /** How the week went league-wide, regardless of what you picked. */
  trends: string[];
};

const emptyRecord = (): Record => ({ wins: 0, losses: 0, pushes: 0 });

function tally(record: Record, result: "win" | "loss" | "push"): void {
  if (result === "win") record.wins += 1;
  else if (result === "loss") record.losses += 1;
  else record.pushes += 1;
}

function show(record: Record): string {
  const base = `${record.wins}-${record.losses}`;
  return record.pushes > 0 ? `${base}-${record.pushes}` : base;
}

function resolved(game: StatGame): Side | "push" | null {
  if (game.status !== "final") return null;
  return winningSide({
    status: "final",
    finalHomeScore: game.homeScore,
    finalAwayScore: game.awayScore,
    frozenHomeSpread: game.spread,
  });
}

export function computeWeekStats(games: StatGame[], picks: StatPick[]): WeekStats {
  const pickByGame = new Map(picks.map((pick) => [pick.gameId, pick]));

  const counted = games.filter(
    (game) => game.status !== "postponed" && game.status !== "canceled",
  );
  const graded = counted.filter((game) => resolved(game) !== null);

  const record = emptyRecord();
  const asFavourite = emptyRecord();
  const asUnderdog = emptyRecord();
  const atHome = emptyRecord();
  const onRoad = emptyRecord();

  let points = 0;
  let lock: WeekStats["lock"] = "none";

  const homeDogs = emptyRecord();
  const favourites = emptyRecord();
  let closeGames = 0;
  let biggestUpset: { team: string; by: number } | null = null;

  for (const game of counted) {
    const covered = resolved(game);
    if (covered === null) continue;

    const spread = game.spread ?? 0;

    // League-wide: how the home underdog and the favourite fared.
    if (spread > 0) {
      tally(homeDogs, covered === "push" ? "push" : covered === "home" ? "win" : "loss");
    }
    if (spread !== 0) {
      const favouriteSide: Side = spread < 0 ? "home" : "away";
      tally(
        favourites,
        covered === "push" ? "push" : covered === favouriteSide ? "win" : "loss",
      );
    }

    if (game.homeScore !== null && game.awayScore !== null) {
      const margin = game.homeScore - game.awayScore;
      if (Math.abs(margin + spread) <= 3) closeGames += 1;

      // An upset is the underdog winning outright, by the widest margin.
      if (spread !== 0) {
        const homeIsDog = spread > 0;
        const dogWonBy = homeIsDog ? margin : -margin;
        if (dogWonBy > 0) {
          const team = homeIsDog ? game.homeTeam : game.awayTeam;
          if (!biggestUpset || dogWonBy > biggestUpset.by) {
            biggestUpset = { team, by: dogWonBy };
          }
        }
      }
    }

    const pick = pickByGame.get(game.id);
    if (!pick) continue;

    const result = covered === "push" ? "push" : covered === pick.side ? "win" : "loss";
    tally(record, result);
    points += pick.points ?? 0;

    if (pick.isLock) lock = result === "win" ? "hit" : result === "push" ? "push" : "missed";

    if (spread !== 0) {
      const tookFavourite = (pick.side === "home") === spread < 0;
      tally(tookFavourite ? asFavourite : asUnderdog, result);
    }
    tally(pick.side === "home" ? atHome : onRoad, result);
  }

  const splits = [
    { label: "Taking the favourite", record: asFavourite },
    { label: "Taking the underdog", record: asUnderdog },
    { label: "Home sides", record: atHome },
    { label: "Road sides", record: onRoad },
  ].filter((split) => split.record.wins + split.record.losses + split.record.pushes > 0);

  const trends: string[] = [];
  if (homeDogs.wins + homeDogs.losses + homeDogs.pushes > 0) {
    trends.push(`Home underdogs went ${show(homeDogs)} against the spread.`);
  }
  if (favourites.wins + favourites.losses + favourites.pushes > 0) {
    const total = favourites.wins + favourites.losses;
    trends.push(
      `Favourites covered ${favourites.wins} of ${total}${
        favourites.pushes > 0 ? `, with ${favourites.pushes} pushing` : ""
      }.`,
    );
  }
  if (closeGames > 0) {
    trends.push(
      `${closeGames} game${closeGames === 1 ? "" : "s"} landed within a field goal of the number.`,
    );
  }
  if (biggestUpset) {
    trends.push(
      `Biggest outright upset: ${biggestUpset.team} won by ${biggestUpset.by} as the underdog.`,
    );
  }

  return {
    complete: counted.length > 0 && graded.length === counted.length,
    gamesGraded: graded.length,
    gamesTotal: counted.length,
    points,
    record,
    lock,
    splits,
    trends,
  };
}

export { show as formatRecord };
