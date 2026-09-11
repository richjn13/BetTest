import { winningSide, type GradableGame, type Side } from "./scoring";
import { abbreviate } from "./teams";

/**
 * Plain-language account of how a finished game turned out and what it did to
 * a pick. Pure, so the wording can be tested rather than eyeballed.
 */
export type GameOutcome = {
  /** The side that covered, "push", or null if there is no result yet. */
  covered: Side | "push" | null;
  /** "Chiefs 27, Bills 24", or null before a final score exists. */
  score: string | null;
  /** "KC won by 3 and covered -2.5", or null. */
  line: string | null;
  /** What it meant for this viewer's pick, or null if they had none. */
  effect: string | null;
  verdict: "win" | "loss" | "push" | "none" | "pending";
};

export type OutcomeInput = {
  homeTeam: string;
  awayTeam: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  spread: number | null;
  status: GradableGame["status"];
  pickedSide: Side | null;
  isLock: boolean;
  points: number | null;
};

function signed(value: number): string {
  const trimmed = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1);
  if (value === 0) return "a pick'em";
  return value > 0 ? `+${trimmed}` : `-${trimmed}`;
}

export function describeOutcome(input: OutcomeInput): GameOutcome {
  const empty: GameOutcome = {
    covered: null,
    score: null,
    line: null,
    effect: null,
    verdict: "pending",
  };

  if (input.status === "postponed" || input.status === "canceled") {
    return {
      ...empty,
      verdict: "none",
      effect: `This game was ${input.status} and does not count toward the week.`,
    };
  }

  if (input.finalHomeScore === null || input.finalAwayScore === null) return empty;

  const home = input.finalHomeScore;
  const away = input.finalAwayScore;
  const score =
    home === away
      ? `${abbreviate(input.awayTeam)} ${away}, ${abbreviate(input.homeTeam)} ${home} (tied)`
      : home > away
        ? `${abbreviate(input.homeTeam)} ${home}, ${abbreviate(input.awayTeam)} ${away}`
        : `${abbreviate(input.awayTeam)} ${away}, ${abbreviate(input.homeTeam)} ${home}`;

  if (input.status !== "final") {
    return { ...empty, score, verdict: "pending" };
  }

  const covered = winningSide({
    status: "final",
    finalHomeScore: home,
    finalAwayScore: away,
    frozenHomeSpread: input.spread,
  });

  const margin = Math.abs(home - away);
  const winner = home > away ? input.homeTeam : input.awayTeam;
  const spreadText = input.spread === null ? null : signed(input.spread);

  let line: string;
  if (covered === "push") {
    line = `${abbreviate(winner)} won by ${margin}, landing exactly on the number. Push.`;
  } else if (spreadText === null) {
    line = home === away ? "Tied, with no line to grade against." : `${abbreviate(winner)} won by ${margin}.`;
  } else {
    const coveringTeam = covered === "home" ? input.homeTeam : input.awayTeam;
    line =
      home === away
        ? `Tied. ${abbreviate(coveringTeam)} covered.`
        : `${abbreviate(winner)} won by ${margin}. ${abbreviate(coveringTeam)} covered.`;
  }

  if (input.pickedSide === null) {
    return { covered, score, line, effect: "You did not pick this game.", verdict: "none" };
  }

  const yourTeam = input.pickedSide === "home" ? input.homeTeam : input.awayTeam;
  const points = input.points;

  if (covered === "push") {
    return {
      covered,
      score,
      line,
      effect: `You had ${abbreviate(yourTeam)}. A push scores 0, with no penalty for the lock.`,
      verdict: "push",
    };
  }

  if (covered === input.pickedSide) {
    const scored = points ?? (input.isLock ? 2 : 1);
    return {
      covered,
      score,
      line,
      effect: `You had ${abbreviate(yourTeam)}${input.isLock ? " as your lock" : ""}. +${scored} point${scored === 1 ? "" : "s"}.`,
      verdict: "win",
    };
  }

  return {
    covered,
    score,
    line,
    effect: `You had ${abbreviate(yourTeam)}${input.isLock ? " as your lock" : ""}. No points.`,
    verdict: "loss",
  };
}
