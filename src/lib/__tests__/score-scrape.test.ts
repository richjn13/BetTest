import { describe, expect, it } from "vitest";
import { scoresFromJson, scoresFromPage, type KnownGame } from "../score-scrape";

const games: KnownGame[] = [
  { id: "g1", homeTeam: "Indiana Hoosiers", awayTeam: "Howard Bison" },
  { id: "g2", homeTeam: "Temple Owls", awayTeam: "Penn State Nittany Lions" },
];

describe("scoresFromPage", () => {
  it("reads a score out of a scoreboard row", () => {
    const html = `
      <div class="board">
        <div class="game"><span>Howard Bison</span><span>7</span>
          <span>Indiana Hoosiers</span><span>56</span><span>Final</span></div>
      </div>`;
    const { found } = scoresFromPage(html, [games[0]]);
    expect(found).toEqual([{ gameId: "g1", home: 56, away: 7, final: true }]);
  });

  it("knows a game in progress from one that has ended", () => {
    const html = `<li>Penn State Nittany Lions 21 Temple Owls 3 2nd Quarter</li>`;
    const { found } = scoresFromPage(html, [games[1]]);
    expect(found[0]).toMatchObject({ gameId: "g2", home: 3, away: 21, final: false });
  });

  it("refuses a row where a team has no score after it", () => {
    const html = `<li>Howard Bison at Indiana Hoosiers 7:30 PM</li>`;
    const { found, missed } = scoresFromPage(html, [games[0]]);
    expect(found).toEqual([]);
    expect(missed).toEqual(["Howard Bison at Indiana Hoosiers"]);
  });

  it("takes the number after a name, not a ranking in front of it", () => {
    const html = `<li>#3 Howard Bison 7 #5 Indiana Hoosiers 56 Final</li>`;
    const { found } = scoresFromPage(html, [games[0]]);
    expect(found).toEqual([{ gameId: "g1", home: 56, away: 7, final: true }]);
  });

  it("names the games a page said nothing about", () => {
    const { found, missed } = scoresFromPage("<p>Nothing here</p>", games);
    expect(found).toEqual([]);
    expect(missed).toHaveLength(2);
  });

  it("ignores scripts, and years and ranks that are not scores", () => {
    const html = `
      <script>var season = 2026;</script>
      <tr><td>#3 Howard Bison</td><td>7</td><td>#5 Indiana Hoosiers</td><td>56</td>
      <td>Final</td></tr>`;
    const { found } = scoresFromPage(html, [games[0]]);
    expect(found).toEqual([{ gameId: "g1", home: 56, away: 7, final: true }]);
  });

  it("does not mix two games sitting next to each other", () => {
    const html = `
      <tr><td>Howard Bison</td><td>7</td><td>Indiana Hoosiers</td><td>56</td></tr>
      <tr><td>Penn State Nittany Lions</td><td>21</td><td>Temple Owls</td><td>3</td></tr>`;
    const { found } = scoresFromPage(html, games);
    expect(found).toEqual([
      { gameId: "g1", home: 56, away: 7, final: false },
      { gameId: "g2", home: 3, away: 21, final: false },
    ]);
  });
});

describe("scoresFromJson", () => {
  const payload = {
    events: [
      {
        competitions: [
          {
            status: { type: { completed: true } },
            competitors: [
              { homeAway: "home", score: "31", team: { displayName: "Clemson Tigers", location: "Clemson", name: "Tigers" } },
              { homeAway: "away", score: "17", team: { displayName: "North Carolina Tar Heels", location: "North Carolina", name: "Tar Heels" } },
            ],
          },
        ],
      },
      {
        competitions: [
          {
            status: { type: { completed: false } },
            competitors: [
              { homeAway: "home", score: "7", team: { displayName: "Toledo Rockets", location: "Toledo", name: "Rockets" } },
              { homeAway: "away", score: "3", team: { displayName: "Temple Owls", location: "Temple", name: "Owls" } },
            ],
          },
        ],
      },
    ],
  };

  it("reads both scores and whether the game is over", () => {
    const result = scoresFromJson(payload, [
      { id: "a", homeTeam: "Clemson Tigers", awayTeam: "North Carolina Tar Heels" },
    ]);
    expect(result.found).toEqual([{ gameId: "a", home: 31, away: 17, final: true }]);
    expect(result.missed).toEqual([]);
  });

  it("does not call a game final while it is still on", () => {
    const result = scoresFromJson(payload, [
      { id: "b", homeTeam: "Toledo Rockets", awayTeam: "Temple Owls" },
    ]);
    expect(result.found[0]).toEqual({ gameId: "b", home: 7, away: 3, final: false });
  });

  it("matches a school whose mascot we spell differently", () => {
    const result = scoresFromJson(payload, [
      { id: "c", homeTeam: "Clemson", awayTeam: "North Carolina" },
    ]);
    expect(result.found[0].home).toBe(31);
  });

  it("names the games it could not find rather than guessing", () => {
    const result = scoresFromJson(payload, [
      { id: "d", homeTeam: "Ohio State Buckeyes", awayTeam: "Penn State Nittany Lions" },
    ]);
    expect(result.found).toEqual([]);
    expect(result.missed).toEqual(["Penn State Nittany Lions at Ohio State Buckeyes"]);
  });

  it("treats a payload with no events as nothing found", () => {
    const result = scoresFromJson({}, [{ id: "e", homeTeam: "A Team", awayTeam: "B Team" }]);
    expect(result.found).toEqual([]);
    expect(result.missed).toHaveLength(1);
  });
});
