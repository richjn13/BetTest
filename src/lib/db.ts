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
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
