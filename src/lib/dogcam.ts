import "server-only";
import { db, unwrap } from "./db";

/**
 * The dog camera. One device sits at home with its browser open and its camera
 * running; another device somewhere else watches. The picture goes straight
 * from one to the other over WebRTC, so the only thing the server does is pass
 * a few short messages while the two work out how to reach each other.
 *
 * That is the whole reason this is cheap to run: video never touches a server
 * that anyone bills for. The cost is that both devices have to be awake with
 * the page open, which the camera page says plainly.
 */

/** A camera whose last heartbeat is older than this is treated as gone. */
export const OFFLINE_AFTER_MS = 75_000;

/** Camera devices beat this often. Comfortably inside OFFLINE_AFTER_MS. */
export const HEARTBEAT_MS = 30_000;

/** Handshake messages older than this are no use to anyone. */
const SIGNAL_TTL_MS = 120_000;

/** The mailbox address every camera listens on, in its own room. */
export const CAMERA_INBOX = "camera";

export type CameraStatus = {
  streaming?: boolean;
  facing?: "user" | "environment";
  battery?: number | null;
  watchers?: number;
};

export type Camera = {
  slug: string;
  name: string;
  lastSeenAt: string;
  status: CameraStatus;
  online: boolean;
};

export type Signal = {
  id: number;
  sender: string;
  kind: string;
  payload: Record<string, unknown>;
};

type CameraRow = {
  slug: string;
  name: string | null;
  last_seen_at: string;
  status: CameraStatus | null;
};

function toCamera(row: CameraRow, now = Date.now()): Camera {
  const lastSeen = Date.parse(row.last_seen_at);
  return {
    slug: row.slug,
    name: row.name || row.slug,
    lastSeenAt: row.last_seen_at,
    status: row.status ?? {},
    online: Number.isFinite(lastSeen) && now - lastSeen < OFFLINE_AFTER_MS,
  };
}

export async function listCameras(): Promise<Camera[]> {
  const rows = unwrap<CameraRow[]>(
    await db().from("dogcam_cameras").select("*").order("name"),
  );
  const now = Date.now();
  return rows.map((row) => toCamera(row, now));
}

export async function getCamera(slug: string): Promise<Camera | null> {
  const rows = unwrap<CameraRow[]>(
    await db().from("dogcam_cameras").select("*").eq("slug", slug).limit(1),
  );
  return rows[0] ? toCamera(rows[0]) : null;
}

/**
 * The camera device checking in. This is also how a camera first appears: open
 * the page on a new device and it registers itself, so there is no separate
 * "add a camera" step to get wrong from a phone.
 */
export async function heartbeat(
  slug: string,
  name: string,
  status: CameraStatus,
): Promise<void> {
  unwrap(
    await db()
      .from("dogcam_cameras")
      .upsert(
        {
          slug,
          name: name.slice(0, 60),
          status,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      )
      .select("slug"),
  );
}

export async function forgetCamera(slug: string): Promise<void> {
  unwrap(
    await db().from("dogcam_cameras").delete().eq("slug", slug).select("slug"),
  );
  unwrap(
    await db().from("dogcam_signals").delete().eq("room", slug).select("id"),
  );
}

export async function sendSignal(
  room: string,
  recipient: string,
  sender: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  unwrap(
    await db()
      .from("dogcam_signals")
      .insert({ room, recipient, sender, kind, payload })
      .select("id"),
  );
}

/**
 * Everything addressed to one browser since it last looked. The cursor is the
 * row id, so a message is never read twice and never missed, which polling on
 * a timestamp cannot promise.
 */
export async function readSignals(
  room: string,
  recipient: string,
  after: number,
): Promise<Signal[]> {
  const rows = unwrap<
    {
      id: number;
      sender: string;
      kind: string;
      payload: Record<string, unknown> | null;
    }[]
  >(
    await db()
      .from("dogcam_signals")
      .select("id, sender, kind, payload")
      .eq("room", room)
      .eq("recipient", recipient)
      .gt("id", after)
      .order("id")
      .limit(50),
  );
  return rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    kind: row.kind,
    payload: row.payload ?? {},
  }));
}

/**
 * Sweep old handshake rows. Called from the poll the camera is making anyway,
 * so the table stays small without anything scheduled to go wrong.
 */
export async function sweepSignals(): Promise<void> {
  const cutoff = new Date(Date.now() - SIGNAL_TTL_MS).toISOString();
  await db().from("dogcam_signals").delete().lt("created_at", cutoff);
}
