import "server-only";
import { redirect } from "next/navigation";
import { getGroup, getUser } from "./queries";
import { membershipForGroup } from "./session";
import type { Group, User } from "./types";

export type Viewer = { group: Group; user: User };

/**
 * The signed-in member for a group, or a redirect to /join. Membership is
 * re-read from the database on every request so a removed member loses access
 * immediately rather than when their cookie expires.
 */
export async function requireViewer(groupId: string): Promise<Viewer> {
  const membership = membershipForGroup(groupId);
  if (!membership) redirect("/join");

  const [group, user] = await Promise.all([getGroup(groupId), getUser(membership.userId)]);
  if (!group || !user || user.group_id !== groupId) redirect("/join");

  return { group, user };
}

export async function requireAdmin(groupId: string): Promise<Viewer> {
  const viewer = await requireViewer(groupId);
  if (!viewer.user.is_admin) redirect(`/g/${groupId}/picks`);
  return viewer;
}
