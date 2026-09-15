"use client";

import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { unlockAction, type GateState } from "./actions";

const EMPTY: GateState = { error: null };

export function Gate() {
  const [state, action] = useFormState(unlockAction, EMPTY);

  return (
    <form action={action} className="card space-y-3 p-5">
      <div>
        <label className="label" htmlFor="passcode">
          Passcode
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          className="field"
          required
        />
      </div>
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
        >
          {state.error}
        </p>
      )}
      <SubmitButton pendingLabel="Checking...">Unlock</SubmitButton>
      <p className="text-sm text-muted">
        These pages look inside your home, so they stay behind a passcode. It is
        the one you set as DOGCAM_PASSCODE.
      </p>
    </form>
  );
}
