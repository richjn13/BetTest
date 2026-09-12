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

// -------------------------------------------------------------- college

/**
 * Mascots that are more than one word. Without these, stripping the mascot off
 * "Georgia Tech Yellow Jackets" leaves "Georgia Tech Yellow", which is worse
 * than doing nothing.
 *
 * The list is the point rather than a nuisance: a school's name is what people
 * recognise, and there is no rule that separates it from a mascot, only this.
 */
const MULTI_WORD_MASCOTS = new Set([
  "yellow jackets",
  "fighting irish",
  "fighting illini",
  "crimson tide",
  "blue devils",
  "blue raiders",
  "blue hens",
  "blue jays",
  "red raiders",
  "red wolves",
  "red storm",
  "red flash",
  "golden bears",
  "golden eagles",
  "golden flashes",
  "golden gophers",
  "golden hurricane",
  "golden knights",
  "golden panthers",
  "nittany lions",
  "horned frogs",
  "green wave",
  "mean green",
  "scarlet knights",
  "sun devils",
  "wolf pack",
  "demon deacons",
  "tar heels",
  "ragin cajuns",
  "ragin' cajuns",
  "seminoles",
  "black knights",
  "black bears",
  "mountain hawks",
  "sea gulls",
  "purple aces",
  "purple eagles",
  "great danes",
  "big green",
  "big red",
  "rainbow warriors",
  "boll weevils",
  "thundering herd",
  "war hawks",
  "screaming eagles",
  "governors",
  "hilltoppers",
  "runnin bulldogs",
  "runnin' bulldogs",
]);

/**
 * Splits a college team as the feed writes it into the school and the mascot.
 *
 * "Indiana Hoosiers" is two facts, and only one of them is any use to somebody
 * who does not follow college football closely. The mascot is what gets shown
 * on its own everywhere else, and half the country shares the popular ones --
 * there are a dozen Bulldogs and nearly as many Wildcats.
 *
 * A name it cannot split comes back whole as the school, with no mascot. That
 * is the safe failure: the full name is always better than the wrong half.
 */
export function splitTeamName(full: string): { school: string; mascot: string | null } {
  const words = full.trim().split(/\s+/);
  if (words.length < 2) return { school: full.trim(), mascot: null };

  const lastTwo = words.slice(-2).join(" ").toLowerCase();
  if (words.length > 2 && MULTI_WORD_MASCOTS.has(lastTwo)) {
    return { school: words.slice(0, -2).join(" "), mascot: words.slice(-2).join(" ") };
  }

  return { school: words.slice(0, -1).join(" "), mascot: words[words.length - 1] };
}

/**
 * The short form to print in a sentence. The NFL abbreviates to three letters,
 * which everyone reads; college uses the school, because a college
 * abbreviation is built from the mascot and says nothing.
 */
export function shortName(team: string, sport: "nfl" | "ncaaf" = "nfl"): string {
  return sport === "ncaaf" ? splitTeamName(team).school : abbreviate(team);
}
