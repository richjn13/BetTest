"use server";

import { revalidatePath } from "next/cache";
import { lock, unlock } from "@/lib/dogcam-gate";

export type GateState = { error: string | null };

export async function unlockAction(
  _prev: GateState,
  formData: FormData,
): Promise<GateState> {
  const attempt = String(formData.get("passcode") ?? "");
  if (!attempt.trim()) return { error: "Type the passcode." };
  if (!unlock(attempt)) return { error: "That passcode is not right." };
  revalidatePath("/dogcam");
  return { error: null };
}

export async function lockAction(): Promise<void> {
  lock();
  revalidatePath("/dogcam");
}
