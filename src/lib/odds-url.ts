/**
 * URL building for The Odds API, kept separate and pure so the paths can be
 * tested without a network call.
 *
 * The distinction that matters: the sports listing lives at the API root,
 * while odds and scores live under a specific sport. A single sport-scoped
 * base URL silently produces /v4/sports/americanfootball_nfl/sports, which is
 * a 404 rather than an obvious error.
 */

export const API_ROOT = "https://api.the-odds-api.com/v4";
export const NFL_PATH = "/sports/americanfootball_nfl";

/** Paths are relative to the API root, so each one says where it really lives. */
export const ENDPOINTS = {
  /** Root-level. Lists available sports, and is not billed against the quota. */
  sports: "/sports",
  odds: `${NFL_PATH}/odds`,
  scores: `${NFL_PATH}/scores`,
} as const;

export type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

export function oddsApiUrl(
  path: Endpoint,
  apiKey: string,
  params: Record<string, string> = {},
): URL {
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/**
 * A failing endpoint may answer with an HTML error page. Dumping that markup
 * into the admin panel hides the one useful word in it, so reduce it to text.
 */
export function readableError(body: string, limit = 200): string {
  const text = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
