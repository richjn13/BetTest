/**
 * Environment access. Read lazily so a missing variable fails at request time
 * with a clear message rather than at build time on a machine that has no
 * secrets configured.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/**
 * Required variables checked in one pass, for use before any work that writes
 * to the database. Returns the names that are missing or have whitespace on
 * either end, which is what a value pasted on a touchscreen often picks up.
 */
export function missingConfiguration(): string[] {
  const problems: string[] = [];
  for (const name of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SESSION_SECRET",
  ]) {
    const value = process.env[name];
    if (!value || value !== value.trim()) problems.push(name);
  }
  return problems;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get oddsApiKey() {
    return required("ODDS_API_KEY");
  },
  get oddsApiBookmakers(): string[] {
    return (process.env.ODDS_API_BOOKMAKERS ?? "")
      .split(",")
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean);
  },
  get hasOddsApiKey() {
    return Boolean(process.env.ODDS_API_KEY);
  },
};
