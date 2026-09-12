"use client";

import Link from "next/link";
import { sportLabel, type Sport } from "@/lib/sports";

/**
 * NFL or NCAA. Only shown when both have a week open, since a single-sport
 * pool should not carry a control with one option.
 */
export function SportTabs({
  sports,
  current,
  basePath,
}: {
  sports: Sport[];
  current: Sport;
  basePath: string;
}) {
  if (sports.length < 2) return null;

  return (
    <div className="mb-3 inline-flex rounded-lg border border-edge p-0.5" role="tablist">
      {sports.map((sport) => {
        const active = sport === current;
        return (
          <Link
            key={sport}
            href={`${basePath}?sport=${sport}`}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
              active ? "bg-ink text-surface" : "text-muted hover:text-ink"
            }`}
          >
            {sportLabel(sport)}
          </Link>
        );
      })}
    </div>
  );
}
