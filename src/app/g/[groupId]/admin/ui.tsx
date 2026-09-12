"use client";

/**
 * The pieces both admin panels are built from. They live here so the panel and
 * the games page cannot drift into two slightly different looking things.
 */
import { useEffect, useState } from "react";
import type { AdminState } from "./state";

export function Section({
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="card" open={defaultOpen}>
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold">{title}</summary>
      <div className="border-t border-edge px-4 py-4">
        {aside && <div className="mb-3 flex justify-end">{aside}</div>}
        {children}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ stack

export type Panel = {
  /** Stable across renders and releases: it is what the saved order stores. */
  id: string;
  title: string;
  /** One short line shown on the closed header, so it still says something. */
  hint?: string;
  aside?: React.ReactNode;
  body: React.ReactNode;
};

/**
 * The admin page as a stack of closed drawers.
 *
 * Everything used to be open at once, which put eleven forms and three tables
 * on one screen and made finding the one you wanted a scroll rather than a
 * glance. Closed by default, each header carries a line of its own state, and
 * opening one leaves the others alone -- a strict accordion would keep shutting
 * the thing you were working in.
 *
 * The order is yours: Arrange puts a pair of arrows on each header and the
 * result is remembered in this browser. Panels this browser has never heard of
 * appear at the end, so a new one is never invisible.
 */
export function SectionStack({
  panels,
  storageKey,
}: {
  panels: Panel[];
  storageKey: string;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [arranging, setArranging] = useState(false);
  const [ready, setReady] = useState(false);

  // Read once on the client. Server-rendered markup cannot know any of this,
  // and rendering it differently on the first pass would be a hydration error.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${storageKey}:order`);
      if (saved) setOrder(JSON.parse(saved) as string[]);
      const opened = window.localStorage.getItem(`${storageKey}:open`);
      if (opened) setOpen(JSON.parse(opened) as string[]);
    } catch {
      // A blocked or full store is not worth failing the page over.
    }
    setReady(true);
  }, [storageKey]);

  const remember = (key: string, value: string[]) => {
    try {
      window.localStorage.setItem(`${storageKey}:${key}`, JSON.stringify(value));
    } catch {
      // As above: the page works, the preference just does not stick.
    }
  };

  const known = new Set(panels.map((panel) => panel.id));
  const sorted = [
    ...order.filter((id) => known.has(id)),
    ...panels.filter((panel) => !order.includes(panel.id)).map((panel) => panel.id),
  ]
    .map((id) => panels.find((panel) => panel.id === id))
    .filter((panel): panel is Panel => panel !== undefined);

  const toggle = (id: string) => {
    const next = open.includes(id) ? open.filter((entry) => entry !== id) : [...open, id];
    setOpen(next);
    remember("open", next);
  };

  const move = (id: string, by: -1 | 1) => {
    const ids = sorted.map((panel) => panel.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setOrder(ids);
    remember("order", ids);
  };

  const reset = () => {
    setOrder([]);
    remember("order", []);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-sm">
        {arranging && order.length > 0 && (
          <button type="button" onClick={reset} className="text-muted hover:underline">
            Reset order
          </button>
        )}
        <button
          type="button"
          onClick={() => setArranging((current) => !current)}
          className="text-accent hover:underline"
        >
          {arranging ? "Done" : "Arrange"}
        </button>
      </div>

      {sorted.map((panel, index) => {
        const isOpen = ready && open.includes(panel.id);
        return (
          <section key={panel.id} className="card overflow-hidden">
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => toggle(panel.id)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  aria-hidden
                  className={`shrink-0 text-xs text-muted transition-transform ${
                    isOpen ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{panel.title}</span>
                  {panel.hint && !isOpen && (
                    <span className="block truncate text-xs text-muted">{panel.hint}</span>
                  )}
                </span>
              </button>

              {arranging && (
                <span className="flex shrink-0 items-center gap-1 pr-3">
                  <button
                    type="button"
                    onClick={() => move(panel.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${panel.title} up`}
                    className="btn px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(panel.id, 1)}
                    disabled={index === sorted.length - 1}
                    aria-label={`Move ${panel.title} down`}
                    className="btn px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>

            {isOpen && (
              <div className="border-t border-edge px-4 py-4">
                {panel.aside && <div className="mb-3 flex justify-end">{panel.aside}</div>}
                {panel.body}
              </div>
            )}
          </section>
        );
      })}
    </div>
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
