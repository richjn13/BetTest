import "server-only";
import { pollFromHtml, type PollEntry } from "./rankings";

/**
 * Fetching the AP Top 25 from a web page, for nothing.
 *
 * The page is read and parsed here. No model is involved, which is the whole
 * point: asking one to go and look cost 231,056 tokens on a run that came back
 * with nothing, for twenty-five names that are sitting in a table.
 *
 * AP_POLL_URL overrides the source without a redeploy, for when the page moves
 * or you would rather use another one.
 */

const DEFAULT_URL = "https://www.ncaa.com/rankings/football/fbs/associated-press";
const TIMEOUT_MS = 12_000;
/** A rankings page is well under this. Anything larger is not one. */
const MAX_BYTES = 4_000_000;
/** Fewer than this and we have read furniture, not a poll. */
const MIN_ENTRIES = 10;

export function pollUrl(): string {
  return process.env.AP_POLL_URL?.trim() || DEFAULT_URL;
}

export type PollFetch = {
  entries: PollEntry[];
  error: string | null;
  url: string;
};

export async function fetchPollFromWeb(): Promise<PollFetch> {
  const url = pollUrl();

  let html: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Some sites answer a bare fetch with a consent page.
        "user-agent": "Mozilla/5.0 (compatible; PickemBot/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return { entries: [], url, error: `${url} answered ${response.status}.` };
    }

    const body = await response.text();
    html = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { entries: [], url, error: `Could not reach ${url}: ${reason}` };
  }

  const entries = pollFromHtml(html);
  if (entries.length < MIN_ENTRIES) {
    return {
      entries: [],
      url,
      error:
        `Read ${url} but found only ${entries.length} ranked teams in it. The page ` +
        "layout may have changed. Paste the poll in instead, or set AP_POLL_URL to " +
        "another page.",
    };
  }

  return { entries, url, error: null };
}
