/**
 * The browser half of the camera: talking to the postbox, and the settings
 * both ends have to agree on. Imported by client components only.
 */

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type Signal = {
  id: number;
  sender: string;
  kind: string;
  payload: Record<string, unknown>;
};

/** Commands a watcher can send down the open connection, no server involved. */
export type Command =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "flip" }
  | { action: "torch"; on: boolean };

/** The address every camera listens on, inside its own room. Matches the server. */
export const CAMERA_INBOX_ADDRESS = "camera";

/** How often a running camera says "still here". */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The camera tables live in their own migration, which a deployment that only
 * ever wanted the pick'em pool will not have run. Postgres calls that "relation
 * does not exist", which is true and unhelpful; this says what to do about it.
 */
export function explainMissingTable(message: string): string {
  if (!/relation .*dogcam.* does not exist/i.test(message)) return message;
  return (
    "The camera tables are not in the database yet. Run " +
    "supabase/migrations/0014_dogcam.sql in the Supabase SQL editor, then reload."
  );
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A URL-safe name for a camera: "Living room" becomes "living-room". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `cam-${randomId()}`
  );
}

export async function postSignal(
  room: string,
  to: string,
  from: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("/api/dogcam/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room, to, from, kind, payload }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `The server refused the message (${response.status}).`,
    );
  }
}

export async function fetchSignals(
  room: string,
  me: string,
  after: number,
): Promise<{ signals: Signal[]; cursor: number }> {
  const response = await fetch(
    `/api/dogcam/signal?room=${encodeURIComponent(room)}&me=${encodeURIComponent(me)}&after=${after}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `The server refused the poll (${response.status}).`,
    );
  }
  return (await response.json()) as { signals: Signal[]; cursor: number };
}

/**
 * Keep the screen on while the camera is running. iOS only offers this from
 * 16.4, and only while the page is in front -- which is the same limit the
 * camera itself has, so there is nothing lost by failing quietly here.
 */
export async function holdScreenAwake(): Promise<{ release: () => void }> {
  let sentinel: { release: () => Promise<void> } | null = null;
  let dropped = false;

  const acquire = async () => {
    try {
      const lock = (
        navigator as Navigator & {
          wakeLock?: {
            request: (
              type: "screen",
            ) => Promise<{ release: () => Promise<void> }>;
          };
        }
      ).wakeLock;
      if (!lock || dropped) return;
      sentinel = await lock.request("screen");
    } catch {
      // Unsupported, or refused because the tab is in the background. The page
      // already tells the reader to turn Auto-Lock off, which is the real fix.
    }
  };

  // The lock is dropped whenever the page goes away and has to be taken again.
  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  await acquire();

  return {
    release: () => {
      dropped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    },
  };
}
