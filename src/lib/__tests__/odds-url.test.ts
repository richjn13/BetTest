import { describe, expect, it } from "vitest";
import { ENDPOINTS, oddsApiUrl, readableError } from "../odds-url";

const strip = (url: URL) => `${url.origin}${url.pathname}`;

describe("oddsApiUrl", () => {
  it("puts the sports listing at the API root, not under a sport", () => {
    // The bug this guards: a single sport-scoped base URL produced
    // /v4/sports/americanfootball_nfl/sports, which is a 404.
    expect(strip(oddsApiUrl(ENDPOINTS.sports, "k"))).toBe(
      "https://api.the-odds-api.com/v4/sports",
    );
  });

  it("puts odds and scores under the NFL sport", () => {
    expect(strip(oddsApiUrl(ENDPOINTS.odds, "k"))).toBe(
      "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds",
    );
    expect(strip(oddsApiUrl(ENDPOINTS.scores, "k"))).toBe(
      "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores",
    );
  });

  it("sends the key as a query parameter, escaped", () => {
    const url = oddsApiUrl(ENDPOINTS.odds, "abc/123+xyz");
    expect(url.searchParams.get("apiKey")).toBe("abc/123+xyz");
    expect(url.toString()).not.toContain("abc/123+xyz");
  });

  it("carries extra parameters through", () => {
    const url = oddsApiUrl(ENDPOINTS.odds, "k", { regions: "us", markets: "spreads" });
    expect(url.searchParams.get("regions")).toBe("us");
    expect(url.searchParams.get("markets")).toBe("spreads");
  });
});

describe("readableError", () => {
  it("reduces an HTML error page to its text", () => {
    const page =
      "<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n" +
      "<h1>Not Found</h1>\n<p>The requested URL was not found on the server.</p>";
    expect(readableError(page)).toBe(
      "404 Not Found Not Found The requested URL was not found on the server.",
    );
  });

  it("leaves a plain message alone", () => {
    expect(readableError("Usage quota exceeded")).toBe("Usage quota exceeded");
  });

  it("truncates something very long", () => {
    expect(readableError("x".repeat(500), 20)).toBe(`${"x".repeat(20)}...`);
  });

  it("handles an empty body", () => {
    expect(readableError("")).toBe("");
  });
});
