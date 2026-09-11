import { createClient } from "@supabase/supabase-js";
import { probeOddsFeed } from "@/lib/odds";

export const dynamic = "force-dynamic";

/**
 * Configuration check. Reachable without signing in, and written so it cannot
 * throw -- it is the page you open when everything else is throwing.
 *
 * It reports whether each value is set and whether it looks like the right
 * kind of value. It never prints a secret.
 */

type Status = "ok" | "warn" | "fail";
type Check = { label: string; status: Status; detail: string };

const TABLES = [
  "groups",
  "users",
  "weeks",
  "games",
  "picks",
  "point_adjustments",
  "admin_actions",
];

function checkPresence(name: string, optional = false): Check {
  const raw = process.env[name];
  if (!raw) {
    return {
      label: name,
      status: optional ? "warn" : "fail",
      detail: optional
        ? "Not set. Optional -- the odds feed stays off until you add it."
        : "Not set. Add it in Vercel under Settings, Environment Variables, then redeploy.",
    };
  }
  if (raw !== raw.trim()) {
    return {
      label: name,
      status: "fail",
      detail:
        "Set, but it starts or ends with a space. Pasting on a touchscreen often " +
        "adds one. Edit the value in Vercel, delete the stray space, and redeploy.",
    };
  }
  return { label: name, status: "ok", detail: `Set, ${raw.length} characters.` };
}

function checkSupabaseUrl(): Check {
  const base = checkPresence("SUPABASE_URL");
  if (base.status !== "ok") return base;

  const raw = process.env.SUPABASE_URL as string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return { ...base, status: "fail", detail: "Set, but it is not an https:// address." };
    }
    return { ...base, detail: `Set, pointing at ${url.host}.` };
  } catch {
    return {
      ...base,
      status: "fail",
      detail: "Set, but it is not a valid URL. It should look like https://abcdefgh.supabase.co",
    };
  }
}

/**
 * The anon key and the service role key sit next to each other in Supabase and
 * look almost identical, so this decodes the key to say which one you pasted.
 * A Supabase JWT's payload is public metadata -- decoding it reveals nothing
 * the key does not already announce.
 */
function checkServiceRoleKey(): Check {
  const base = checkPresence("SUPABASE_SERVICE_ROLE_KEY");
  if (base.status !== "ok") return base;

  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY as string).trim();

  if (raw.startsWith("sb_secret_")) {
    return { ...base, detail: "Set, and it is a secret key. Correct." };
  }
  if (raw.startsWith("sb_publishable_")) {
    return {
      ...base,
      status: "fail",
      detail:
        "This is the publishable key. You need the secret key from the same page.",
    };
  }

  const parts = raw.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf8"),
      ) as { role?: string };

      if (payload.role === "service_role") {
        return { ...base, detail: "Set, and it is the service_role key. Correct." };
      }
      if (payload.role === "anon") {
        return {
          ...base,
          status: "fail",
          detail:
            "This is the anon key, not the service_role key. They sit next to each " +
            "other in Supabase. Copy the one marked secret, then redeploy.",
        };
      }
      return {
        ...base,
        status: "warn",
        detail: `Set, but its role is "${payload.role ?? "unknown"}" rather than service_role.`,
      };
    } catch {
      // Falls through to the unrecognized case below.
    }
  }

  return {
    ...base,
    status: "warn",
    detail: "Set, but not in a format this check recognizes. It may still work.",
  };
}

async function checkDatabase(): Promise<Check[]> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    return [
      {
        label: "Database",
        status: "fail",
        detail: "Skipped, because the Supabase URL or key is missing.",
      },
    ];
  }

  let client;
  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (error) {
    return [{ label: "Database", status: "fail", detail: describe(error) }];
  }

  const checks: Check[] = [];
  for (const table of TABLES) {
    try {
      const { error } = await client.from(table).select("id", { head: true, count: "exact" });
      if (error) {
        checks.push({
          label: `Table ${table}`,
          status: "fail",
          detail: error.message,
        });
      } else {
        checks.push({ label: `Table ${table}`, status: "ok", detail: "Present." });
      }
    } catch (error) {
      checks.push({ label: `Table ${table}`, status: "fail", detail: describe(error) });
    }
  }
  return checks;
}

/**
 * Checks the odds feed. The /sports endpoint this uses does not count against
 * the monthly quota, so opening this page as often as you like costs nothing.
 */
/**
 * Two API keys now live side by side and look nothing alike, which makes them
 * easy to paste into the wrong box. This names that mistake directly instead
 * of leaving it to show up later as a 401.
 */
function checkKeyShape(name: "ODDS_API_KEY" | "ANTHROPIC_API_KEY"): Check {
  const base = checkPresence(name, true);
  if (base.status !== "ok") return base;

  const value = (process.env[name] as string).trim();
  const anthropicShaped = value.startsWith("sk-ant-");

  if (name === "ANTHROPIC_API_KEY") {
    return anthropicShaped
      ? { ...base, detail: "Set, and it has the shape of an Anthropic key." }
      : {
          ...base,
          status: "warn",
          detail:
            "Set, but it does not start with sk-ant-. Anthropic keys do. Check you " +
            "have not pasted The Odds API key here.",
        };
  }

  if (anthropicShaped) {
    return {
      ...base,
      status: "fail",
      detail:
        "This is an Anthropic key, not an Odds API key. The Odds API key is a " +
        "plain string of letters and digits with no sk- prefix.",
    };
  }
  if (/[\s"']/.test(value) || value.includes("=")) {
    return {
      ...base,
      status: "fail",
      detail:
        "Set, but it contains a space, quote, or equals sign. Paste only the key " +
        "itself, with no apiKey= prefix and no quotes around it.",
    };
  }
  return { ...base, detail: `Set, ${value.length} characters.` };
}

/** Creating a pool is owner-only, and unset means nobody can. */
function checkCreateGroupSecret(): Check {
  const value = process.env.CREATE_GROUP_SECRET?.trim();
  if (!value) {
    return {
      label: "CREATE_GROUP_SECRET",
      status: "warn",
      detail:
        "Not set, so nobody can start a new pool, including you. Existing pools " +
        "are unaffected. Set it if you want to create another.",
    };
  }
  if (value.length < 8) {
    return {
      label: "CREATE_GROUP_SECRET",
      status: "warn",
      detail: `Set, but only ${value.length} characters. Make it longer.`,
    };
  }
  return {
    label: "CREATE_GROUP_SECRET",
    status: "ok",
    detail: "Set. Only someone with this key can start a pool.",
  };
}

async function checkOddsFeed(): Promise<Check[]> {
  const key = checkKeyShape("ODDS_API_KEY");
  if (key.status !== "ok") {
    return [
      key,
      {
        label: "The Odds API",
        status: "warn",
        detail:
          key.status === "fail"
            ? "Not checked, because the key above needs fixing first."
            : "Not checked, because no key is set. Games can still be added by hand.",
      },
    ];
  }

  try {
    const probe = await probeOddsFeed();
    const { remaining, used } = probe.quota;
    const low = remaining !== null && remaining < 50 ? "warn" : "ok";

    // Used plus remaining is the size of the allowance, which saves guessing
    // at what plan the key is on.
    const detail =
      probe.ok && remaining !== null
        ? used !== null
          ? `The key works. ${used} used, ${remaining} left of ${used + remaining} this period.`
          : `The key works. ${remaining} calls left this period.`
        : probe.message;

    return [
      key,
      {
        label: "The Odds API",
        status: probe.ok ? (low as Status) : "fail",
        detail,
      },
    ];
  } catch (error) {
    return [
      key,
      { label: "The Odds API", status: "fail", detail: describe(error) },
    ];
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DOT: Record<Status, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
};

function CheckRow({ check }: { check: Check }) {
  return (
    <li className="flex gap-3 border-b border-edge py-3 last:border-0">
      <span
        aria-hidden
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[check.status]}`}
      />
      <span className="min-w-0">
        <span className="block font-mono text-sm font-medium">{check.label}</span>
        <span className="block text-sm text-muted">
          <span className="sr-only">{check.status}: </span>
          {check.detail}
        </span>
      </span>
    </li>
  );
}

export default async function SetupPage() {
  const config: Check[] = [
    checkSupabaseUrl(),
    checkServiceRoleKey(),
    checkPresence("SESSION_SECRET"),
    checkPresence("CRON_SECRET"),
    checkKeyShape("ANTHROPIC_API_KEY"),
    checkCreateGroupSecret(),
  ];

  const [database, oddsFeed] = await Promise.all([checkDatabase(), checkOddsFeed()]);
  const all = [...config, ...database, ...oddsFeed];
  const failing = all.filter((check) => check.status === "fail").length;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Setup check</h1>
      <p className="mt-1 text-sm text-muted">
        What this deployment can and cannot see. No secret values are shown.
      </p>

      <p
        className={`mt-4 rounded-lg px-4 py-3 text-sm ${
          failing === 0
            ? "bg-emerald-500/10 text-emerald-600"
            : "bg-red-500/10 text-red-500"
        }`}
      >
        {failing === 0
          ? "Everything checks out. If the app is still failing, the cause is not configuration."
          : `${failing} problem${failing === 1 ? "" : "s"} below. Fix each one in Vercel under Settings, Environment Variables, then redeploy from the Deployments tab.`}
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        Configuration
      </h2>
      <ul className="card mt-2 px-4">
        {config.map((check) => (
          <CheckRow key={check.label} check={check} />
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        Database
      </h2>
      <ul className="card mt-2 px-4">
        {database.map((check) => (
          <CheckRow key={check.label} check={check} />
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        Odds feed
      </h2>
      <ul className="card mt-2 px-4">
        {oddsFeed.map((check) => (
          <CheckRow key={check.label} check={check} />
        ))}
      </ul>

      <p className="mt-6 text-xs text-muted">
        A missing table means the schema script did not finish. Run
        supabase/migrations/0001_init.sql again in the Supabase SQL editor; it is
        safe to run twice. A rejected odds key usually means it was set in Vercel
        without redeploying afterwards.
      </p>
    </main>
  );
}
