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
