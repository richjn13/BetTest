/**
 * The two competitions the app covers. Everything sport-specific is named
 * here so adding a third would not mean hunting through the codebase.
 */
export const SPORTS = ["nfl", "ncaaf"] as const;
export type Sport = (typeof SPORTS)[number];

export type SportConfig = {
  key: Sport;
  /** How it is written in the interface. */
  label: string;
  /** Short form for tabs and badges. */
  short: string;
  /** The Odds API's identifier. */
  oddsApiKey: string;
  /** Whether games are confined to Saturdays, as college games are here. */
  saturdayOnly: boolean;
  /** Whether a poll ranking is worth showing beside a team. */
  ranked: boolean;
  /**
   * Whether the week's slate is chosen rather than complete. College plays
   * more games a Saturday than anyone would pick, so its slate is a selection
   * an admin pulled; the scheduled refresh must not add to it.
   */
  curatedSlate: boolean;
  /** How many games make a good week to pick, where the slate is chosen. */
  slateGoal: number | null;
  highestWeek: number;
};

const SPORT_CONFIG: Record<Sport, SportConfig> = {
  nfl: {
    key: "nfl",
    label: "NFL",
    short: "NFL",
    oddsApiKey: "americanfootball_nfl",
    saturdayOnly: false,
    ranked: false,
    curatedSlate: false,
    slateGoal: null,
    highestWeek: 22,
  },
  ncaaf: {
    key: "ncaaf",
    label: "NCAA",
    short: "NCAA",
    oddsApiKey: "americanfootball_ncaaf",
    saturdayOnly: true,
    ranked: true,
    curatedSlate: true,
    slateGoal: 10,
    highestWeek: 16,
  },
};

export function isSport(value: unknown): value is Sport {
  return typeof value === "string" && (SPORTS as readonly string[]).includes(value);
}

/**
 * Falls back to the NFL rather than returning undefined. A row written before
 * a column existed, or a value from an older deployment, would otherwise take
 * a page down on a property read of nothing.
 */
export function sportConfig(sport: Sport): SportConfig {
  return SPORT_CONFIG[sport] ?? SPORT_CONFIG.nfl;
}

export function sportLabel(sport: Sport): string {
  return sportConfig(sport).label;
}
