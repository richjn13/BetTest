import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runRefresh } from "@/lib/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled maintenance, run by Vercel Cron on the schedule in vercel.json.
 *
 *   1. freeze the line on every game past kickoff
 *   2. pull current spreads and any newly scheduled games
 *   3. pull scores for games in progress or just finished
 *   4. regrade every pick on a resolved game
 *
 * Steps 1 and 4 run even when the odds feed is down, since they only need data
 * already stored.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runRefresh();

  return NextResponse.json(
    {
      ok: result.ok,
      // An odds feed failure is reported but not an HTTP error: stored spreads
      // are untouched, so members keep seeing the last known line. A database
      // failure is a real outage and answers as one.
      degraded: result.degraded,
      frozen: result.frozen,
      odds: { gamesInserted: result.gamesInserted, spreadsUpdated: result.spreadsUpdated },
      scores: { scoresUpdated: result.scoresUpdated },
      graded: result.graded,
    },
    { status: result.databaseError ? 500 : 200 },
  );
}
