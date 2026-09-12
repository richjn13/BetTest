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
    highestWeek: 22,
  },
  ncaaf: {
    key: "ncaaf",
    label: "NCAA",
    short: "NCAA",
    oddsApiKey: "americanfootball_ncaaf",
    saturdayOnly: true,
    ranked: true,
    highestWeek: 16,
  },
};

export function isSport(value: unknown): value is Sport {
  return typeof value === "string" && (SPORTS as readonly string[]).includes(value);
}

export function sportConfig(sport: Sport): SportConfig {
  return SPORT_CONFIG[sport];
}

export function sportLabel(sport: Sport): string {
  return SPORT_CONFIG[sport].label;
}
