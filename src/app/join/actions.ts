"use server";

import { redirect } from "next/navigation";
import { missingConfiguration } from "@/lib/env";
import { AppError, createGroup, joinGroup, signIn } from "@/lib/queries";
import { addMembership } from "@/lib/session";

export type FormState = { error: string | null };

const PIN_PATTERN = /^\d{4,8}$/;

function read(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

function validate(username: string, pin: string): string | null {
  if (username.length < 2 || username.length > 24) {
    return "Pick a username between 2 and 24 characters.";
  }
  if (!PIN_PATTERN.test(pin)) {
    return "Your PIN must be 4 to 8 digits.";
  }
  return null;
}

/**
 * Runs one of the three flows and turns whatever happens into something the
 * form can show.
 *
 * The configuration check comes first, before any database write. Signing the
 * session cookie needs SESSION_SECRET, and that happens after the group and
 * user rows exist -- so without this check a misconfigured deployment would
 * create a group, fail to sign anyone into it, and leave an orphan behind on
 * every retry.
 */
async function attempt(
  work: () => Promise<{ group: { id: string }; user: { id: string } }>,
): Promise<FormState | never> {
  const missing = missingConfiguration();
  if (missing.length > 0) {
    return {
      error:
        `This deployment is missing ${missing.join(", ")}. ` +
        "Open /setup for the details. Nothing was saved.",
    };
  }

  let destination: string;
  try {
    const { group, user } = await work();
    addMembership({ userId: user.id, groupId: group.id });
    destination = `/g/${group.id}/picks`;
  } catch (error) {
    // Next signals redirect() by throwing; never swallow that.
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof AppError) return { error: error.message };
    // Anything else is a bug or an outage. Say what it was: this is a private
    // pool, the message comes from Postgres rather than from user data, and a
    // blank "something went wrong" cannot be acted on.
    console.error(error);
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `Couldn't finish that: ${reason}. Open /setup to check.` };
  }
  // redirect throws, so it has to happen outside the try block.
  redirect(destination);
}

export async function createGroupAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const groupName = read(form, "groupName");
  const username = read(form, "username");
  const pin = read(form, "pin");
  const ownerKey = read(form, "ownerKey");

  if (!ownerKey) return { error: "Enter the owner key." };
  if (groupName.length < 1 || groupName.length > 60) {
    return { error: "Give the group a name of 60 characters or fewer." };
  }
  const invalid = validate(username, pin);
  if (invalid) return { error: invalid };

  return attempt(() => createGroup(groupName, username, pin, ownerKey));
}

export async function joinGroupAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const joinCode = read(form, "joinCode");
  const username = read(form, "username");
  const pin = read(form, "pin");

  if (!joinCode) return { error: "Enter the group's join code." };
  const invalid = validate(username, pin);
  if (invalid) return { error: invalid };

  return attempt(() => joinGroup(joinCode, username, pin));
}

export async function signInAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const joinCode = read(form, "joinCode");
  const username = read(form, "username");
  const pin = read(form, "pin");

  if (!joinCode || !username || !pin) {
    return { error: "Enter the join code, your username, and your PIN." };
  }
  return attempt(() => signIn(joinCode, username, pin));
}
