import { describe, expect, it } from "vitest";
import { parseInstant } from "../instant";

describe("parseInstant", () => {
  it("reads a UTC instant", () => {
    expect(parseInstant("2026-09-20T17:00:00.000Z")?.toISOString()).toBe(
      "2026-09-20T17:00:00.000Z",
    );
  });

  it("reads an offset and converts it", () => {
    expect(parseInstant("2026-09-20T13:00:00-04:00")?.toISOString()).toBe(
      "2026-09-20T17:00:00.000Z",
    );
  });

  it("refuses a time with no zone, rather than guessing at one", () => {
    expect(parseInstant("2026-09-20T13:00")).toBeNull();
  });

  it("refuses nonsense and blanks", () => {
    expect(parseInstant("")).toBeNull();
    expect(parseInstant("next Tuesday")).toBeNull();
    expect(parseInstant("2026-13-45T99:00:00Z")).toBeNull();
  });
});
