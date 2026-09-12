import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key. Every table has RLS
 * enabled with no policies, so this key is the only way in and must never be
 * exposed to the browser -- keep this module out of client components.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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
  if (!/does not exist/i.test(message) || !/column/i.test(message)) return message;
  return (
    `${message}. The database is missing a column the app needs, which means a ` +
    "migration in supabase/migrations/ was never run. Open /setup: it names the file."
  );
}
