"use client";

import Link from "next/link";
import { useRef } from "react";
import type { Week } from "@/lib/types";

/**
 * Week switcher. A scrolling row of tabs rather than a dropdown: on a phone it
 * shows where you are and what else exists without opening anything.
 */
export function WeekTabs({
  weeks,
  currentWeekId,
  basePath,
}: {
  weeks: Week[];
  currentWeekId: string;
  basePath: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  if (weeks.length <= 1) return null;

  return (
    <div
      ref={strip}
      className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Week"
    >
      {weeks.map((week) => {
        const active = week.id === currentWeekId;
        return (
          <Link
            key={week.id}
            href={`${basePath}?week=${week.id}`}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm
              font-medium transition-colors ${
                active
                  ? "border-transparent bg-ink text-surface"
                  : "border-edge text-muted hover:border-accent hover:text-ink"
              }`}
          >
            {week.season_type === "regular" ? `Week ${week.week_number}` : week.label}
            {week.closed_at && <span className="ml-1 opacity-60">·</span>}
          </Link>
        );
      })}
    </div>
  );
}
