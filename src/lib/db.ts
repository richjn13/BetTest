import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Long enough for a cold database, short enough to retry inside a render. */
const REQUEST_TIMEOUT_MS = 8_000;
const ATTEMPTS = 3;
const BACKOFF_MS = [150, 450];

/**
 * Supabase is reached over the network, and a page that reads it has no
 * tolerance for a blip: one dropped connection during a render throws, and the
 * whole page becomes "Something broke" for a reader who did nothing wrong.
 * Occasional failures on load are exactly what that looks like.
 *
 * So a request that fails at the transport, times out, or comes back as one of
 * the gateway errors that mean "try again" is retried twice, briefly. Anything
 * the database actually answered -- including every 4xx -- is passed straight
 * back: those are not going to change on a second attempt.
 */
async function retryingFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status < 502 || response.status > 504 || attempt === ATTEMPTS - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === ATTEMPTS - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt] ?? 450));
  }

  throw lastError ?? new Error("The database did not respond.");
}

/**
 * Server-only Supabase client using the service role key. Every table has RLS
 * enabled with no policies, so this key is the only way in and must never be
 * exposed to the browser -- keep this module out of client components.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: retryingFetch },
    });
  }
  return client;
}

/**
 * Supabase returns errors in-band; this turns them into thrown exceptions.
 *
 * The client is untyped (no generated database types), so `data` comes back as
 * a structural guess that does not match our row types. Widening it to unknown
 * here lets each call site name the row type it expects, once.
 */
export function unwrap<T = unknown>(result: {
  data: unknown;
  error: { message: string } | null;
}): T {
  if (result.error) throw new Error(explain(result.error.message));
  return result.data as T;
}

/**
 * A query for a column the database does not have means a migration was never
 * run. Postgres says so in its own terms -- "column games.total_points does not
 * exist" -- which is accurate and tells the reader nothing about what to do.
 * The app then fails on every page at once, because every page reads games.
 */
export function explain(message: string): string {
  if (/timed out|aborted|fetch failed/i.test(message)) {
    return `${message}. The database did not answer in time, three times over. Reload; if it keeps happening, check the Supabase project is awake.`;
  }
  if (!/does not exist/i.test(message) || !/column/i.test(message)) return message;
  return (
    `${message}. The database is missing a column the app needs, which means a ` +
    "migration in supabase/migrations/ was never run. Open /setup: it names the file."
  );
}
