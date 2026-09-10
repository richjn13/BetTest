"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import {
  createGroupAction,
  joinGroupAction,
  signInAction,
  type FormState,
} from "./actions";

const EMPTY: FormState = { error: null };

type Tab = "join" | "create" | "signin";

const TABS: { id: Tab; label: string }[] = [
  { id: "join", label: "Join" },
  { id: "create", label: "Start a group" },
  { id: "signin", label: "Sign in" },
];

export function JoinForms() {
  const [tab, setTab] = useState<Tab>("join");

  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-edge" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-3 text-sm font-medium transition-colors ${
              tab === id
                ? "border-b-2 border-accent text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === "join" && <JoinTab />}
        {tab === "create" && <CreateTab />}
        {tab === "signin" && <SignInTab />}
      </div>
    </div>
  );
}

function Error({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
      {message}
    </p>
  );
}

function JoinCodeField() {
  return (
    <div>
      <label className="label" htmlFor="joinCode">
        Join code
      </label>
      <input
        id="joinCode"
        name="joinCode"
        required
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="ABC123"
        className="field font-mono uppercase tracking-widest"
      />
    </div>
  );
}

function UsernameField({ hint }: { hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor="username">
        Username
      </label>
      <input
        id="username"
        name="username"
        required
        minLength={2}
        maxLength={24}
        autoComplete="username"
        className="field"
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function PinField({ hint }: { hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor="pin">
        PIN
      </label>
      <input
        id="pin"
        name="pin"
        required
        inputMode="numeric"
        pattern="\d{4,8}"
        autoComplete="current-password"
        className="field font-mono tracking-widest"
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function JoinTab() {
  const [state, action] = useFormState(joinGroupAction, EMPTY);
  return (
    <form action={action} className="space-y-4">
      <Error message={state.error} />
      <JoinCodeField />
      <UsernameField hint="How you'll show up on the leaderboard." />
      <PinField hint="4 to 8 digits. You'll need it to sign in on another device." />
      <SubmitButton pendingLabel="Joining...">Join the pool</SubmitButton>
    </form>
  );
}

function CreateTab() {
  const [state, action] = useFormState(createGroupAction, EMPTY);
  return (
    <form action={action} className="space-y-4">
      <Error message={state.error} />
      <div>
        <label className="label" htmlFor="groupName">
          Group name
        </label>
        <input id="groupName" name="groupName" required maxLength={60} className="field" />
      </div>
      <UsernameField hint="You'll be the group admin." />
      <PinField hint="4 to 8 digits. You'll need it to sign in on another device." />
      <SubmitButton pendingLabel="Creating...">Create the group</SubmitButton>
    </form>
  );
}

function SignInTab() {
  const [state, action] = useFormState(signInAction, EMPTY);
  return (
    <form action={action} className="space-y-4">
      <Error message={state.error} />
      <p className="text-sm text-muted">
        Already joined on another device? Use the same join code, username, and PIN.
      </p>
      <JoinCodeField />
      <UsernameField />
      <PinField />
      <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
    </form>
  );
}
