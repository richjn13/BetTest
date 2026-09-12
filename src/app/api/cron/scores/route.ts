import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sportsWithOpenWeeks } from "@/lib/queries";
import { runRefresh } from "@/lib/refresh";

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
      graded: result.graded,
    });
  }

  const failed = runs.some((run) => !run.ok);
  return NextResponse.json(
    { ok: !failed, runs, at: new Date().toISOString() },
    { status: 200 },
  );
}
