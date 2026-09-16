import { describe, expect, it } from "vitest";
import {
  normalizeSchool,
  parsePastedPoll,
  pollFromHtml,
  pollInForce,
  rankFor,
  readPoll,
  weeksGovernedByPoll,
} from "../rankings";

const poll = [
  { rank: 1, team: "Ohio State" },
  { rank: 2, team: "Texas A&M" },
  { rank: 3, team: "Miami" },
  { rank: 4, team: "Texas" },
];

describe("normalizeSchool", () => {
  it("strips case and punctuation", () => {
    expect(normalizeSchool("Texas A&M")).toBe("texas a m");
    expect(normalizeSchool("  Miami (OH) ")).toBe("miami oh");
  });
});

describe("readPoll", () => {
  it("keeps well-formed entries and drops the rest", () => {
    const entries = readPoll({
      rankings: [
        { rank: 1, team: "Georgia" },
        { rank: 0, team: "Too high" },
        { rank: 26, team: "Too low" },
        { rank: 2, team: "X" },
        { rank: 1, team: "Duplicate rank" },
        { rank: 3, team: "Oregon" },
      ],
    });
    expect(entries).toEqual([
      { rank: 1, team: "Georgia" },
      { rank: 3, team: "Oregon" },
    ]);
  });

  it("returns nothing for a payload with no list", () => {
    expect(readPoll({})).toEqual([]);
    expect(readPoll(null)).toEqual([]);
  });
});

describe("rankFor", () => {
  it("matches a feed name that carries the nickname", () => {
    expect(rankFor("Ohio State Buckeyes", poll)).toBe(1);
    expect(rankFor("Texas A&M Aggies", poll)).toBe(2);
  });

  it("returns null for an unranked team", () => {
    expect(rankFor("Purdue Boilermakers", poll)).toBe(null);
  });

  it("does not let a short name claim a longer school", () => {
    // "Texas" must not rank Texas State, and "Miami" must not rank Miami (OH).
    expect(rankFor("Texas State Bobcats", poll)).toBe(null);
    expect(rankFor("Texas Longhorns", poll)).toBe(4);
  });
});

describe("parsePastedPoll", () => {
  it("reads the shapes a poll gets pasted in", () => {
    const entries = parsePastedPoll(`
      1. Ohio State (12-0)
      2) Texas A&M 1,455
      3 Georgia
      4. Miami (FL) 11-1
    `);
    expect(entries).toEqual([
      { rank: 1, team: "Ohio State" },
      { rank: 2, team: "Texas A&M" },
      { rank: 3, team: "Georgia" },
      { rank: 4, team: "Miami" },
    ]);
  });

  it("ignores headings, blank lines and anything past 25", () => {
    const entries = parsePastedPoll("AP Top 25\n\n1. Alabama\n26. Not ranked\n0. Nope");
    expect(entries).toEqual([{ rank: 1, team: "Alabama" }]);
  });

  it("keeps the first of a repeated rank", () => {
    expect(parsePastedPoll("1. Oregon\n1. Someone else")).toEqual([
      { rank: 1, team: "Oregon" },
    ]);
  });

  it("returns nothing for text that is not a poll", () => {
    expect(parsePastedPoll("no numbers here at all")).toEqual([]);
  });
});

describe("pollFromHtml", () => {
  const page = (rows: string) => `
    <html><head><style>.r1 { color: red }</style>
    <script>var week = 3; var top = "1. Nobody";</script></head>
    <body><nav><a href="/x">3 Scores</a></nav>
    <h2>Week 3 rankings</h2>
    <table><thead><tr><th>Rank</th><th>School</th><th>Record</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;

  const row = (rank: number, school: string, record: string, points: string) =>
    `<tr><td>${rank}</td><td>${school}</td><td>${record}</td><td>${points}</td></tr>`;

  it("reads a rankings table out of surrounding page furniture", () => {
    const html = page(
      row(1, "Ohio State", "12-0", "1,550") +
        row(2, "Texas A&amp;M", "11-1", "1,480") +
        row(3, "Georgia", "11-1", "1,402"),
    );
    expect(pollFromHtml(html)).toEqual([
      { rank: 1, team: "Ohio State" },
      { rank: 2, team: "Texas A&M" },
      { rank: 3, team: "Georgia" },
    ]);
  });

  it("ignores a stray number that does not continue the sequence", () => {
    // The nav link "3 Scores" appears before rank 1 and must not take third.
    const entries = pollFromHtml(page(row(1, "Alabama", "10-2", "1,500")));
    expect(entries).toEqual([{ rank: 1, team: "Alabama" }]);
  });

  it("stops at the first gap rather than mis-numbering the rest", () => {
    const html = page(row(1, "Oregon", "12-0", "1,550") + row(3, "Georgia", "11-1", "1,402"));
    expect(pollFromHtml(html)).toEqual([{ rank: 1, team: "Oregon" }]);
  });

  it("returns nothing for a page with no rankings in it", () => {
    expect(pollFromHtml("<html><body><p>Nothing here</p></body></html>")).toEqual([]);
  });
});

describe("pollInForce", () => {
  const polls = [{ weekNumber: 1 }, { weekNumber: 3 }, { weekNumber: 5 }];

  it("prefers the week's own poll", () => {
    expect(pollInForce(polls, 3)).toEqual({ weekNumber: 3 });
  });

  it("falls back to the most recent one before it", () => {
    // Week 4 has no poll of its own; week 3's still stands.
    expect(pollInForce(polls, 4)).toEqual({ weekNumber: 3 });
    expect(pollInForce(polls, 99)).toEqual({ weekNumber: 5 });
  });

  it("uses the earliest later poll when there is nothing before", () => {
    expect(pollInForce(polls, 0)).toEqual({ weekNumber: 1 });
  });

  it("returns nothing when no poll is stored at all", () => {
    expect(pollInForce([], 3)).toBe(null);
  });
});

describe("weeksGovernedByPoll", () => {
  const weeks = [1, 2, 3, 4].map((weekNumber) => ({ weekNumber }));

  it("covers the later weeks that have no poll of their own", () => {
    const covered = weeksGovernedByPoll(weeks, [2], 2).map((week) => week.weekNumber);
    expect(covered).toEqual([1, 2, 3, 4]);
  });

  it("stops at the next poll", () => {
    const covered = weeksGovernedByPoll(weeks, [2, 4], 2).map((week) => week.weekNumber);
    expect(covered).toEqual([1, 2, 3]);
  });

  it("leaves earlier weeks to the poll that already covers them", () => {
    const covered = weeksGovernedByPoll(weeks, [1, 3], 3).map((week) => week.weekNumber);
    expect(covered).toEqual([3, 4]);
  });

  it("agrees with pollInForce on every week", () => {
    const filed = [1, 3];
    for (const week of weeks) {
      const ruling = pollInForce(
        filed.map((weekNumber) => ({ weekNumber })),
        week.weekNumber,
      );
      const covered = weeksGovernedByPoll(weeks, filed, ruling!.weekNumber);
      expect(covered.map((one) => one.weekNumber)).toContain(week.weekNumber);
    }
  });
});
