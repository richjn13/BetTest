import { NextResponse } from "next/server";
import { readSignals, sendSignal, sweepSignals } from "@/lib/dogcam";
import { explainMissingTable } from "@/lib/dogcam-client";
import { requireUnlocked } from "@/lib/dogcam-gate";

/**
 * The postbox two browsers use to introduce themselves. Nothing here carries
 * video: an offer, an answer, and a handful of network candidates, all of which
 * stop mattering the moment the two are connected.
 */

export const dynamic = "force-dynamic";

const MAX_PAYLOAD = 16_000;

function fail(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    { error: explainMissingTable(message) },
    { status: 500 },
  );
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  const denied = requireUnlocked();
  if (denied) return denied;

  const url = new URL(request.url);
  const room = url.searchParams.get("room")?.trim();
  const me = url.searchParams.get("me")?.trim();
  const after = Number(url.searchParams.get("after") ?? 0);
  if (!room || !me) {
    return NextResponse.json(
      { error: "room and me are required" },
      { status: 400 },
    );
  }

  try {
    const signals = await readSignals(
      room,
      me,
      Number.isFinite(after) ? after : 0,
    );
    // Piggy-backed on a poll that was happening anyway, so old rows are cleared
    // out without anything scheduled that could quietly stop running.
    if (Math.random() < 0.02) await sweepSignals();
    return NextResponse.json({
      signals,
      cursor: signals.length ? signals[signals.length - 1].id : after,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const denied = requireUnlocked();
  if (denied) return denied;

  let body: {
    room?: string;
    to?: string;
    from?: string;
    kind?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }

  const { room, to, from, kind, payload = {} } = body;
  if (!room || !to || !from || !kind) {
    return NextResponse.json(
      { error: "room, to, from and kind are required" },
      { status: 400 },
    );
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD) {
    return NextResponse.json({ error: "message too large" }, { status: 413 });
  }

  try {
    await sendSignal(room, to, from, kind, payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
