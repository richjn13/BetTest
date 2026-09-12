"use client";

import Link from "next/link";
import { sportLabel, type Sport } from "@/lib/sports";

/** What the board is showing: one competition, or both at once. */
export type Scope = "all" | Sport;

/**
 * All, NCAA, NFL -- in that order, because that is the order they are wanted
 * in. Only shown when both competitions have a week open; a single-sport pool
 * should not carry a control with one option.
 */
export function SportTabs({
  sports,
  current,
  basePath,
}: {
  sports: Sport[];
  current: Scope;
  basePath: string;
}) {
  if (sports.length < 2) return null;

  const tabs: { scope: Scope; label: string }[] = [
    { scope: "all", label: "All" },
    ...(["ncaaf", "nfl"] as const)
      .filter((sport) => sports.includes(sport))
      .map((sport) => ({ scope: sport as Scope, label: sportLabel(sport) })),
  ];

  return (
    <div className="mb-3 inline-flex rounded-lg border border-edge p-0.5" role="tablist">
      {tabs.map((tab) => {
        const active = tab.scope === current;
        return (
          <Link
            key={tab.scope}
            href={`${basePath}?sport=${tab.scope}`}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
              active ? "bg-ink text-surface" : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
