import { spreadForSide } from "./format";
import { coverMargin, winningSide, type GradableGame, type Side } from "./scoring";
import { shortName } from "./teams";

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
  /** Decides how a team is named in the sentence. Defaults to the NFL. */
  sport?: "nfl" | "ncaaf";
};

export function describeOutcome(input: OutcomeInput): GameOutcome {
  // College names read as the school, the NFL as a three-letter code.
  const short = (team: string) => shortName(team, input.sport ?? "nfl");

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
      ? `${short(input.awayTeam)} ${away}, ${short(input.homeTeam)} ${home} (tied)`
      : home > away
        ? `${short(input.homeTeam)} ${home}, ${short(input.awayTeam)} ${away}`
        : `${short(input.awayTeam)} ${away}, ${short(input.homeTeam)} ${home}`;

  if (input.status !== "final") {
    return { ...empty, score, verdict: "pending" };
  }

  const covered = winningSide({
    status: "final",
    finalHomeScore: home,
    finalAwayScore: away,
    frozenHomeSpread: input.spread,
  });

  // A final game with both scores always resolves; this keeps the type honest
  // rather than asserting it away.
  if (covered === null) return { ...empty, score };

  const margin = Math.abs(home - away);
  const winner = home > away ? input.homeTeam : input.awayTeam;
  // The line is hidden on the pick buttons once a game is settled, so this is
  // where it lives afterwards: named next to the side it applied to.
  let line: string;
  if (covered === "push") {
    const number = input.spread === null ? "" : ` (${spreadForSide(input.spread, "home")})`;
    line = `${short(winner)} won by ${margin}, landing exactly on the number${number}. Push.`;
  } else if (input.spread === null) {
    line =
      home === away
        ? "Tied, with no line to grade against."
        : `${short(winner)} won by ${margin}. No line was set.`;
  } else {
    const coveringTeam = covered === "home" ? input.homeTeam : input.awayTeam;
    const coveringLine = spreadForSide(input.spread, covered);
    line =
      home === away
        ? `Tied. ${short(coveringTeam)} ${coveringLine} covered.`
        : `${short(winner)} won by ${margin}. ${short(coveringTeam)} ${coveringLine} covered.`;
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
      effect: `You had ${short(yourTeam)}. A push scores 0, with no penalty for the lock.`,
      verdict: "push",
    };
  }

  if (covered === input.pickedSide) {
    const scored = points ?? (input.isLock ? 2 : 1);
    return {
      covered,
      score,
      line,
      effect: `You had ${short(yourTeam)}${input.isLock ? " as your lock" : ""}. +${scored} point${scored === 1 ? "" : "s"}.`,
      verdict: "win",
    };
  }

  return {
    covered,
    score,
    line,
    effect: `You had ${short(yourTeam)}${input.isLock ? " as your lock" : ""}. No points.`,
    verdict: "loss",
  };
}

// ------------------------------------------------------------- consensus

export type Consensus = { total: number; home: number; away: number };

/**
 * How much of the group got a settled game right. Returns null while the game
 * is undecided or nobody picked it, and treats a push as nobody scoring rather
 * than as a percentage, since points are what the number is really about.
 */
export function consensusVerdict(
  consensus: Consensus,
  covered: Side | "push" | null,
): { right: number; total: number; percent: number } | "push" | null {
  if (consensus.total === 0 || covered === null) return null;
  if (covered === "push") return "push";

  const right = covered === "home" ? consensus.home : consensus.away;
  return {
    right,
    total: consensus.total,
    percent: Math.round((right / consensus.total) * 100),
  };
}

// ------------------------------------------------------------------- live

/**
 * Where a pick stands while the game is still being played.
 *
 * "ahead" means the side you took is covering the line right now, "behind"
 * means it is not, "level" means the game is sitting exactly on the number.
 * Null means there is nothing to say yet: the game has not started, has
 * finished, has no score, or you did not pick it.
 *
 * This is deliberately a different question from who won. Nothing here is
 * settled, and the word for it has to carry that or it will be read as a
 * result.
 */
export type LiveStanding = {
  state: "ahead" | "behind" | "level";
  /** Points the picked side has in hand against the line, or is short by. */
  margin: number;
};

export function liveStanding(input: {
  status: GradableGame["status"];
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  spread: number | null;
  pickedSide: Side | null;
}): LiveStanding | null {
  if (input.status !== "live") return null;
  if (input.pickedSide === null) return null;
  if (input.finalHomeScore === null || input.finalAwayScore === null) return null;

  // Positive means the home side is covering, so the away side's position is
  // its negation.
  const home = coverMargin(input.finalHomeScore, input.finalAwayScore, input.spread ?? 0);
  const margin = input.pickedSide === "home" ? home : -home;

  if (margin > 0) return { state: "ahead", margin };
  if (margin < 0) return { state: "behind", margin: Math.abs(margin) };
  return { state: "level", margin: 0 };
}
