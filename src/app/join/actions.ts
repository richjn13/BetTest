"use server";

import { redirect } from "next/navigation";
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

/** Server actions surface AppError to the member and hide anything else. */
async function attempt(
  work: () => Promise<{ group: { id: string }; user: { id: string } }>,
): Promise<FormState | never> {
  let destination: string;
  try {
    const { group, user } = await work();
    addMembership({ userId: user.id, groupId: group.id });
    destination = `/g/${group.id}/picks`;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    console.error(error);
    return { error: "Something went wrong. Try again." };
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

  if (groupName.length < 1 || groupName.length > 60) {
    return { error: "Give the group a name of 60 characters or fewer." };
  }
  const invalid = validate(username, pin);
  if (invalid) return { error: invalid };

  return attempt(() => createGroup(groupName, username, pin));
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
