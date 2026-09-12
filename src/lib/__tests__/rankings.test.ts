import { describe, expect, it } from "vitest";
import { normalizeSchool, parsePastedPoll, rankFor, readPoll } from "../rankings";

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
