"use client";

import { useRouter } from "next/navigation";
import type { Week } from "@/lib/types";

export function WeekPicker({
  weeks,
  currentWeekId,
  basePath,
}: {
  weeks: Week[];
  currentWeekId: string;
  basePath: string;
}) {
  const router = useRouter();
  if (weeks.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Week</span>
      <select
        value={currentWeekId}
        onChange={(event) => router.push(`${basePath}?week=${event.target.value}`)}
        className="field w-auto py-1.5 text-sm"
      >
        {weeks.map((week) => (
          <option key={week.id} value={week.id}>
            {week.season_year} · {week.label}
          </option>
        ))}
      </select>
    </label>
  );
}
