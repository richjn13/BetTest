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
  /**
   * Gate on creating a new pool. Unset means nobody can create one, which is
   * the safe default for an app whose join page is public.
   */
  get createGroupSecret(): string | null {
    const value = process.env.CREATE_GROUP_SECRET?.trim();
    return value ? value : null;
  },

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

  /**
   * Every key the deployment may use, in order of preference.
   *
   * ODDS_API_KEY takes a comma-separated list so a pool run by two people can
   * use both their accounts: each is that person's own, under their own name,
   * with its own allowance. One key exhausted no longer stops the app -- the
   * next one is tried.
   */
  get oddsApiKeys(): string[] {
    const seen = new Set<string>();
    for (const raw of (process.env.ODDS_API_KEY ?? "").split(",")) {
      const key = raw.trim();
      if (key) seen.add(key);
    }
    return [...seen];
  },
  get oddsApiBookmakers(): string[] {
    return (process.env.ODDS_API_BOOKMAKERS ?? "")
      .split(",")
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean);
  },
  /**
   * How the two browsers find a path to each other. The public STUN servers
   * are free and enough for most home-to-phone connections; a relay (TURN) is
   * the fallback when a network refuses to let two peers talk directly, and a
   * relay carries the video, so it is the one part of this that can cost money.
   * Left unset, there is no relay and a stubborn network simply fails to
   * connect -- which is the cheap default, on purpose.
   */
  get dogcamIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
    const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];
    const turn = process.env.DOGCAM_TURN_URL?.trim();
    if (turn) {
      servers.push({
        urls: turn.split(",").map((url) => url.trim()).filter(Boolean),
        username: process.env.DOGCAM_TURN_USERNAME?.trim(),
        credential: process.env.DOGCAM_TURN_CREDENTIAL?.trim(),
      });
    }
    return servers;
  },
  get hasOddsApiKey() {
    return Boolean(process.env.ODDS_API_KEY);
  },
};
