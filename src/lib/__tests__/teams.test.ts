import { describe, expect, it } from "vitest";
import { splitTeamName } from "../teams";

describe("splitTeamName", () => {
  it("separates a one-word mascot from the school", () => {
    expect(splitTeamName("Indiana Hoosiers")).toEqual({
      school: "Indiana",
      mascot: "Hoosiers",
    });
    expect(splitTeamName("Texas A&M Aggies")).toEqual({
      school: "Texas A&M",
      mascot: "Aggies",
    });
  });

  it("keeps a two-word mascot together", () => {
    expect(splitTeamName("Georgia Tech Yellow Jackets")).toEqual({
      school: "Georgia Tech",
      mascot: "Yellow Jackets",
    });
    expect(splitTeamName("Penn State Nittany Lions")).toEqual({
      school: "Penn State",
      mascot: "Nittany Lions",
    });
  });

  it("keeps a bracketed location with the school", () => {
    expect(splitTeamName("Miami (OH) RedHawks")).toEqual({
      school: "Miami (OH)",
      mascot: "RedHawks",
    });
  });

  it("returns a single word whole rather than leaving no school", () => {
    expect(splitTeamName("Navy")).toEqual({ school: "Navy", mascot: null });
  });

  it("does not strip two words off a two-word name", () => {
    // "Wolf Pack" is a known mascot, but Nevada Wolf Pack minus both words
    // would leave nothing, so the one-word rule applies instead.
    expect(splitTeamName("Wolf Pack")).toEqual({ school: "Wolf", mascot: "Pack" });
  });
});
