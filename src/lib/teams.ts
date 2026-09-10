/**
 * Team names arrive from The Odds API as full names ("Kansas City Chiefs").
 * Abbreviations keep the mobile layout from wrapping.
 */
const ABBREVIATIONS: Record<string, string> = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

export const NFL_TEAMS = Object.keys(ABBREVIATIONS);

export function abbreviate(team: string): string {
  const known = ABBREVIATIONS[team];
  if (known) return known;
  // Unknown name (a rename, or a manually entered game): fall back to the last
  // word, which is the nickname.
  const nickname = team.trim().split(/\s+/).pop() ?? team;
  return nickname.slice(0, 3).toUpperCase();
}

/** The nickname alone -- "Chiefs" -- for headings where the city is noise. */
export function nickname(team: string): string {
  return team.trim().split(/\s+/).pop() ?? team;
}
