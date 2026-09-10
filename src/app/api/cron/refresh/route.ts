import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncGameState } from "@/lib/grading";
import { refreshOdds, refreshScores } from "@/lib/odds";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled maintenance, run every 15 minutes by Vercel Cron:
 *
 *   1. pull current spreads and any newly scheduled games
 *   2. pull scores for games in progress or just finished
 *   3. freeze the line on every game past kickoff, then regrade
 *
 * Step 3 runs even when the odds feed is down, so lines still freeze on time
 * and finished games still grade from whatever scores we already hold.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const odds = await refreshOdds();
  const scores = await refreshScores();

  // The odds feed degrades softly -- stored spreads are untouched, so members
  // keep seeing the last known line. A database failure is a real outage, so
  // it is reported as one.
  let state: { frozen: number; graded: number } | null = null;
  let databaseError: string | null = null;
  try {
    state = await syncGameState();
  } catch (error) {
    databaseError = error instanceof Error ? error.message : String(error);
    console.error("cron: freezing and grading failed", error);
  }

  const degraded = [odds.error, scores.error, databaseError].filter(
    (message): message is string => Boolean(message),
  );

  return NextResponse.json(
    {
      ok: degraded.length === 0,
      degraded,
      odds: {
        gamesSeen: odds.gamesSeen,
        gamesInserted: odds.gamesInserted,
        spreadsUpdated: odds.spreadsUpdated,
      },
      scores: { gamesSeen: scores.gamesSeen, scoresUpdated: scores.scoresUpdated },
      frozen: state?.frozen ?? null,
      graded: state?.graded ?? null,
    },
    { status: databaseError ? 500 : 200 },
  );
}
