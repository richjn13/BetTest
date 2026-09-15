import { NextResponse } from "next/server";
import {
  forgetCamera,
  heartbeat,
  listCameras,
  type CameraStatus,
} from "@/lib/dogcam";
import { explainMissingTable } from "@/lib/dogcam-client";
import { requireUnlocked } from "@/lib/dogcam-gate";

/**
 * Presence. A camera device says "still here" every half minute while its page
 * is open; everyone else reads that to know whether it is worth opening.
 */

export const dynamic = "force-dynamic";

function fail(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    { error: explainMissingTable(message) },
    { status: 500 },
  );
}

export async function GET(): Promise<NextResponse | Response> {
  const denied = requireUnlocked();
  if (denied) return denied;
  try {
    return NextResponse.json({ cameras: await listCameras() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const denied = requireUnlocked();
  if (denied) return denied;

  let body: { slug?: string; name?: string; status?: CameraStatus };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }
  if (!body.slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    await heartbeat(body.slug, body.name ?? "", body.status ?? {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: Request,
): Promise<NextResponse | Response> {
  const denied = requireUnlocked();
  if (denied) return denied;

  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug)
    return NextResponse.json({ error: "slug is required" }, { status: 400 });

  try {
    await forgetCamera(slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
