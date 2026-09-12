import { cookies } from "next/headers";
import { sign, verifySignature } from "./crypto";
import { env } from "./env";

const COOKIE_NAME = "pickem_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type Membership = { userId: string; groupId: string };

export type Session = {
  memberships: Membership[];
  /** The membership whose group is currently being viewed. */
  activeUserId: string | null;
};

const EMPTY: Session = { memberships: [], activeUserId: null };

type StoredSession = { m: [string, string][]; a: string | null };

function encode(session: Session): string {
  const stored: StoredSession = {
    m: session.memberships.map((membership) => [membership.userId, membership.groupId]),
    a: session.activeUserId,
  };
  const payload = Buffer.from(JSON.stringify(stored)).toString("base64url");
  return `${payload}.${sign(payload, env.sessionSecret)}`;
}

function decode(raw: string | undefined): Session {
  if (!raw) return EMPTY;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return EMPTY;
  if (!verifySignature(payload, signature, env.sessionSecret)) return EMPTY;
  try {
    const stored = JSON.parse(Buffer.from(payload, "base64url").toString()) as StoredSession;
    const memberships = (stored.m ?? []).map(([userId, groupId]) => ({ userId, groupId }));
    const activeUserId =
      stored.a && memberships.some((m) => m.userId === stored.a) ? stored.a : null;
    return { memberships, activeUserId };
  } catch {
    return EMPTY;
  }
}

export function getSession(): Session {
  return decode(cookies().get(COOKIE_NAME)?.value);
}

/** Only callable from a server action or route handler. */
function writeSession(session: Session): void {
  cookies().set(COOKIE_NAME, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSession(): void {
  cookies().delete(COOKIE_NAME);
}

/**
 * Adds a membership and makes it active. Re-joining a group the session
 * already holds replaces the old membership rather than stacking a duplicate.
 */
export function addMembership(membership: Membership): void {
  const current = getSession();
  const memberships = current.memberships.filter((m) => m.groupId !== membership.groupId);
  memberships.push(membership);
  writeSession({ memberships, activeUserId: membership.userId });
}

export function removeMembership(userId: string): void {
  const current = getSession();
  const memberships = current.memberships.filter((m) => m.userId !== userId);
  writeSession({
    memberships,
    activeUserId:
      current.activeUserId === userId ? (memberships[0]?.userId ?? null) : current.activeUserId,
  });
}

export function setActiveMembership(userId: string): void {
  const current = getSession();
  if (!current.memberships.some((m) => m.userId === userId)) return;
  writeSession({ ...current, activeUserId: userId });
}

export function membershipForGroup(groupId: string): Membership | null {
  return getSession().memberships.find((m) => m.groupId === groupId) ?? null;
}
