"use client";

import { useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar } from "@/components/Avatar";
import { saveProfileAction } from "./actions";
import { IDLE } from "./state";

const SIZE = 128;
const MAX_CHARS = 60_000;

/**
 * Shrinks the chosen picture in the browser before it is ever sent: a square
 * centre crop at 128px, re-encoded as JPEG. A phone photo arrives at several
 * megabytes and leaves here at a few kilobytes, which is what makes storing it
 * in a column reasonable.
 */
async function downsample(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process that image.");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();

  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error("That picture would not shrink small enough. Try a different one.");
}

export function ProfileForm({
  groupId,
  username,
  displayName,
  email,
  avatarUrl,
}: {
  groupId: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}) {
  const [state, action] = useFormState(saveProfileAction, IDLE);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [pending, setPending] = useState<string>("");
  const [remove, setRemove] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      const url = await downsample(file);
      setPreview(url);
      setPending(url);
      setRemove(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That picture could not be read.");
    }
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="avatarUrl" value={pending} />
      <input type="hidden" name="removeAvatar" value={remove ? "true" : "false"} />

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          {state.message}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {problem}
        </p>
      )}

      <div className="flex items-center gap-4">
        <Avatar username={username} avatarUrl={remove ? null : preview} size={72} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn text-sm"
          >
            {preview && !remove ? "Change picture" : "Add a picture"}
          </button>
          {preview && !remove && (
            <button
              type="button"
              onClick={() => {
                setRemove(true);
                setPending("");
                if (fileInput.current) fileInput.current.value = "";
              }}
              className="btn text-sm text-muted"
            >
              Remove
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => onPick(event.target.files?.[0])}
          />
        </div>
      </div>
      <p className="-mt-3 text-xs text-muted">
        Shrunk to a 128px square in your browser before it is sent, so a phone
        photo is fine.
      </p>

      <div>
        <label className="label" htmlFor="displayName">
          Name
        </label>
        <input
          id="displayName"
          name="displayName"
          defaultValue={displayName ?? ""}
          maxLength={40}
          className="field"
          placeholder="Optional"
        />
        <p className="mt-1 text-xs text-muted">
          Shown beside your username. Your username stays {username}.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={email ?? ""}
          className="field"
          placeholder="Optional"
        />
        <p className="mt-1 text-xs text-muted">
          Only your group&apos;s admins can see this. Nothing is sent to it.
        </p>
      </div>

      <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Saving...">
        Save profile
      </SubmitButton>
    </form>
  );
}
