import { describe, expect, it } from "vitest";
import { explainMissingTable, slugify } from "../dogcam-client";

describe("slugify", () => {
  it("turns a room name into an address", () => {
    expect(slugify("Living room")).toBe("living-room");
    expect(slugify("Bedroom (Bet's)")).toBe("bedroom-bet-s");
  });

  it("never returns an empty address", () => {
    expect(slugify("!!!")).toMatch(/^cam-[a-z0-9]+$/);
    expect(slugify("")).toMatch(/^cam-[a-z0-9]+$/);
  });

  it("keeps an address short enough to type", () => {
    expect(slugify("a".repeat(100)).length).toBe(40);
  });
});

describe("explainMissingTable", () => {
  it("names the migration to run", () => {
    const message = explainMissingTable(
      'relation "public.dogcam_cameras" does not exist',
    );
    expect(message).toContain("0014_dogcam.sql");
  });

  it("leaves every other failure alone", () => {
    expect(explainMissingTable("network unreachable")).toBe("network unreachable");
  });
});
