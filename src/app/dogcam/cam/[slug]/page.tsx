import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { dogcamEnabled, isUnlocked } from "@/lib/dogcam-gate";
import { Gate } from "../../Gate";
import { CameraStage } from "./CameraStage";

export const dynamic = "force-dynamic";

export const metadata = { title: "Camera" };

/**
 * The page you leave open on the device at home. Naming it in the URL means a
 * bookmark on that device is all the setup there is.
 */
export default function CameraPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { name?: string };
}) {
  if (!dogcamEnabled()) notFound();

  const name = (searchParams.name ?? params.slug.replace(/-/g, " ")).slice(
    0,
    60,
  );

  return (
    <main className="mx-auto w-full max-w-lg space-y-4 p-4">
      <header className="pt-2">
        <h1 className="text-xl font-semibold capitalize">{name}</h1>
        <p className="text-sm text-muted">This device is the camera.</p>
      </header>
      {isUnlocked() ? (
        <CameraStage
          slug={params.slug}
          initialName={name}
          iceServers={env.dogcamIceServers}
        />
      ) : (
        <Gate />
      )}
    </main>
  );
}
