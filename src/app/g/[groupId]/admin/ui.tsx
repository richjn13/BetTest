"use client";

/**
 * The pieces both admin panels are built from. They live here so the panel and
 * the games page cannot drift into two slightly different looking things.
 */
import type { AdminState } from "./state";

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="card" open>
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold">{title}</summary>
      <div className="border-t border-edge px-4 py-4">
        {aside && <div className="mb-3 flex justify-end">{aside}</div>}
        {children}
      </div>
    </details>
  );
}

export function Feedback({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
        {state.message}
      </p>
    );
  }
  return null;
}

export function NoteField({ hint }: { hint: string }) {
  return (
    <div>
      <label className="label">Note (required)</label>
      <input name="note" required className="field" placeholder={hint} />
    </div>
  );
}
