import { notFound } from "next/navigation";
import { getCamera } from "@/lib/dogcam";
import { dogcamEnabled, isUnlocked } from "@/lib/dogcam-gate";
import { env } from "@/lib/env";
import { Gate } from "../../Gate";
import { ViewerStage } from "./ViewerStage";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watching" };

export default async function WatchPage({
  params,
}: {
  params: { slug: string };
}) {
  if (!dogcamEnabled()) notFound();
  if (!isUnlocked()) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 p-4">
        <h1 className="pt-2 text-xl font-semibold">Dog cam</h1>
        <Gate />
      </main>
    );
  }

  // Only for the title: a camera that has never checked in can still be called,
  // and the viewer says plainly when nothing answers.
  const camera = await getCamera(params.slug).catch(() => null);
  const name = camera?.name ?? params.slug.replace(/-/g, " ");

  return (
    <main className="mx-auto w-full max-w-lg space-y-4 p-4">
      <header className="pt-2">
        <h1 className="text-xl font-semibold capitalize">{name}</h1>
        <p className="text-sm text-muted">
          {camera?.online
            ? "Camera is awake."
            : "Camera has not checked in recently."}
        </p>
      </header>
      <ViewerStage
        slug={params.slug}
        name={name}
        iceServers={env.dogcamIceServers}
      />
    </main>
  );
}
