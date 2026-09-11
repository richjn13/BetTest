"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { AppError, updateProfile } from "@/lib/queries";
import type { ProfileState } from "./state";

function text(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

export async function saveProfileAction(
  _previous: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const groupId = text(form, "groupId");
  const { user } = await requireViewer(groupId);

  const avatarField = String(form.get("avatarUrl") ?? "");
  const removeAvatar = text(form, "removeAvatar") === "true";

  try {
    await updateProfile(user.id, {
      displayName: text(form, "displayName") || null,
      email: text(form, "email") || null,
      // "" means the picture was not touched this time.
      avatarUrl: removeAvatar ? null : avatarField === "" ? undefined : avatarField,
    });
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof AppError) return { error: error.message, message: null };
    console.error(error);
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `Couldn't save that: ${reason}`, message: null };
  }

  revalidatePath(`/g/${groupId}/profile`);
  revalidatePath(`/g/${groupId}/leaderboard`);
  return { error: null, message: "Saved." };
}
