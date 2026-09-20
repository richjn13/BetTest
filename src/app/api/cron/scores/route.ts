import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { QUOTA_KEY, type RememberedQuota } from "@/lib/odds";
import { readValue, sportsWithOpenWeeks } from "@/lib/queries";
import { runRefresh } from "@/lib/refresh";

/**
 * Stop spending on scores when the month's allowance runs this low, so there
 * is always enough left to pull next week's lines by hand. Scores lag; a week
 * with no lines cannot be played at all. Override with ODDS_API_MIN_REMAINING.
 */
const MIN_REMAINING = Number(process.env.ODDS_API_MIN_REMAINING) || 50;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scores only, on its own path so a scheduler can call it without a query
 * string. One call to The Odds API per run, which is what makes running this
 * every fifteen minutes during games affordable.
 *
 * It also freezes lines past kickoff and regrades, since both read only stored
 * data and cost nothing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // One pass per sport that currently has an open week. A sport with nothing
  // open costs nothing, since the check is a database read.
  let sports;
  try {
    sports = await sportsWithOpenWeeks();
  } catch (error) {
    // Without this the route answers an empty 500 that says nothing.
    const reason = error instanceof Error ? error.message : String(error);
    console.error("cron: could not read open weeks", error);
    return NextResponse.json(
      { ok: false, error: `Could not read open weeks: ${reason}`, at: new Date().toISOString() },
      { status: 500 },
    );
  }
  // The balance every call writes down, read from the database rather than
  // asked of the feed: this runs on a schedule and an extra round trip on
  // every run is a cost of its own.
  const stored = sports.length > 0 ? await readValue<RememberedQuota>(QUOTA_KEY) : null;
  const remaining = stored?.remaining ?? null;

  if (remaining !== null && remaining < MIN_REMAINING) {
    return NextResponse.json(
      {
        ok: true,
        held: true,
        remaining,
        note:
          `Only ${remaining} odds-feed calls left this month, below the floor of ` +
          `${MIN_REMAINING}. Scores are on hold so the rest stays available for ` +
          "pulling lines. Enter finals by hand, or raise the plan.",
        at: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  const runs = [];
  for (const sport of sports) {
    const result = await runRefresh("scores", sport);
    runs.push({
      sport,
      ok: result.ok,
      // True when no game was waiting on a score, so no API call was spent.
      skipped: result.skipped,
      waitingOn: result.waitingOn,
      degraded: result.degraded,
      frozen: result.frozen,
      scoresUpdated: result.scoresUpdated,
      // What the feed actually said, so a run that writes nothing can be read.
      // Without these a quiet afternoon and a broken match look identical.
      eventsReturned: result.eventsReturned,
      overridden: result.overridden,
      fromPage: result.fromPage ?? 0,
      page: { ...result.page, missed: result.page.missed.slice(0, 6) },
      unmatched: result.unmatched.slice(0, 8),
      unmatchedCount: result.unmatched.length,
      graded: result.graded,
    });
  }

  const failed = runs.some((run) => !run.ok);
  return NextResponse.json(
    { ok: !failed, runs, remaining, at: new Date().toISOString() },
    { status: 200 },
  );
}
