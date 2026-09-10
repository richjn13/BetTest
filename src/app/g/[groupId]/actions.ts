"use server";

import { redirect } from "next/navigation";
import { clearSession, removeMembership, setActiveMembership } from "@/lib/session";

export async function switchGroupAction(form: FormData): Promise<void> {
  const userId = String(form.get("userId") ?? "");
  const groupId = String(form.get("groupId") ?? "");
  if (!userId || !groupId) return;
  setActiveMembership(userId);
  redirect(`/g/${groupId}/picks`);
}

/** Leaves the pool on this device only; the membership itself is untouched. */
export async function signOutAction(form: FormData): Promise<void> {
  const userId = String(form.get("userId") ?? "");
  if (userId) removeMembership(userId);
  else clearSession();
  redirect("/join");
}
