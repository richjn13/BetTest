import { NextResponse } from "next/server";
import { env } from "@/lib/env";
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

  const result = await runRefresh("scores");

  return NextResponse.json(
    {
      ok: result.ok,
      // True when no game was waiting on a score, so no API call was spent.
      skipped: result.skipped,
      degraded: result.degraded,
      frozen: result.frozen,
      scoresUpdated: result.scoresUpdated,
      graded: result.graded,
      at: new Date().toISOString(),
    },
    { status: result.databaseError ? 500 : 200 },
  );
}
