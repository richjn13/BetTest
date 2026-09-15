import "server-only";
import { cookies } from "next/headers";
import { sign, timingSafeEquals, verifySignature } from "./crypto";

/**
 * The camera pages point at the inside of a house, so they are not open to
 * whoever has the link. One shared passcode unlocks them and is remembered in
 * a signed cookie for a month.
 *
 * With DOGCAM_PASSCODE unset the whole section is switched off rather than
 * left open -- the same default the pick'em side takes for creating a pool.
 */

const COOKIE_NAME = "dogcam_pass";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function passcode(): string | null {
  const value = process.env.DOGCAM_PASSCODE?.trim();
  return value ? value : null;
}

export function dogcamEnabled(): boolean {
  return passcode() !== null;
}

/** What the cookie holds: the expiry, signed, so it cannot be extended by hand. */
function token(): string {
  const payload = String(Date.now() + MAX_AGE_SECONDS * 1000);
  return `${payload}.${sign(payload, secret())}`;
}

/**
 * The passcode itself signs the cookie, so changing the passcode signs every
 * device out -- which is the point of changing it.
 */
function secret(): string {
  return `${process.env.SESSION_SECRET ?? ""}:${passcode() ?? ""}`;
}

export function isUnlocked(): boolean {
  if (!dogcamEnabled()) return false;
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;
  if (!verifySignature(payload, signature, secret())) return false;
  return Number(payload) > Date.now();
}

/** True when the passcode matched and the cookie was written. */
export function unlock(attempt: string): boolean {
  const expected = passcode();
  if (!expected || !timingSafeEquals(attempt.trim(), expected)) return false;
  cookies().set(COOKIE_NAME, token(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}

export function lock(): void {
  cookies().delete(COOKIE_NAME);
}

/** Guard for the API routes: they all refuse a request that is not unlocked. */
export function requireUnlocked(): Response | null {
  if (!dogcamEnabled()) {
    return Response.json(
      { error: "The camera section is switched off." },
      { status: 404 },
    );
  }
  if (!isUnlocked()) {
    return Response.json({ error: "Locked." }, { status: 401 });
  }
  return null;
}
