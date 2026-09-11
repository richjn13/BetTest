"use server";

import { requireViewer } from "@/lib/auth";
import { AppError, clearLock, getGame, savePick, setLock } from "@/lib/queries";
import type { Side } from "@/lib/types";

export type PickState = { error: string | null };

/**
 * One action for the whole row: pick a side, or toggle the week's lock. The
 * form posts an intent so the row works without client-side JavaScript.
 */
export async function pickAction(_previous: PickState, form: FormData): Promise<PickState> {
  const groupId = String(form.get("groupId") ?? "");
  const gameId = String(form.get("gameId") ?? "");
  const intent = String(form.get("intent") ?? "");
  if (!groupId || !gameId) return { error: "Something went wrong. Reload and try again." };

  const { user } = await requireViewer(groupId);

  try {
    // A game belongs to the shared NFL slate, so there is nothing group-owned
    // to check here beyond the viewer being a member, which requireViewer did.
    const game = await getGame(gameId);
    if (!game) return { error: "That game no longer exists." };

    if (intent === "home" || intent === "away") {
      await savePick(user.id, gameId, intent as Side);
    } else if (intent === "lock") {
      await setLock(user.id, gameId);
    } else if (intent === "unlock") {
      await clearLock(user.id, gameId);
    } else {
      return { error: "Unrecognized action." };
    }
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    console.error(error);
    return { error: "Couldn't save that pick. Try again." };
  }

  // Deliberately no revalidatePath: the board already shows the change, and
  // re-rendering the page here is what made a tap take seconds.
  return { error: null };
}
