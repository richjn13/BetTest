"use client";

import { useEffect, useState } from "react";
import { sportLabel, type Sport } from "@/lib/sports";

export type Scope = "all" | Sport;

/**
 * The All / NCAA / NFL switch, done in the browser.
 *
 * These were links, so every tap was a round trip to the server: a redraw of
 * the page, the database read behind it, and on a game day a score check as
 * well. All of it to show games already fetched, since the All view loads both
 * competitions anyway. Both boards now arrive together and the tab decides
 * which is on screen, so switching is immediate.
 *
 * The URL is kept in step without a navigation, so a reload or a shared link
 * still lands on the tab you were looking at.
 */
export function PicksView({
  sports,
  initial,
  sections,
}: {
  sports: Sport[];
  initial: Scope;
  /** One entry per competition, in the order they should stack under All. */
  sections: { sport: Sport; content: React.ReactNode }[];
}) {
  const [scope, setScope] = useState<Scope>(initial);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("sport") === scope) return;
    url.searchParams.set("sport", scope);
    // replaceState, not the router: the server has already sent everything
    // this page needs, and a navigation would fetch it all again.
    window.history.replaceState(null, "", url);
  }, [scope]);

  const tabs: { scope: Scope; label: string }[] = [
    ...(sports.length > 1 ? [{ scope: "all" as Scope, label: "All" }] : []),
    ...sports.map((sport) => ({ scope: sport as Scope, label: sportLabel(sport) })),
  ];

  const showing = sections.filter(
    (section) => scope === "all" || section.sport === scope,
  );

  return (
    <div>
      {tabs.length > 1 && (
        <div
          className="mb-3 inline-flex rounded-lg border border-edge p-0.5"
          role="tablist"
        >
          {tabs.map((tab) => {
            const active = tab.scope === scope;
            return (
              <button
                key={tab.scope}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setScope(tab.scope)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active ? "bg-ink text-surface" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-8">
        {showing.map((section, index) => (
          <section key={section.sport} className="space-y-3">
            {/* A labelled rule between the two, so a long scroll never leaves
                you unsure which competition you are looking at. */}
            {index > 0 && (
              <div className="flex items-center gap-3 pt-2">
                <span className="h-px flex-1 bg-edge" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {sportLabel(section.sport)}
                </span>
                <span className="h-px flex-1 bg-edge" />
              </div>
            )}
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}
