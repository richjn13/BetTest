import Link from "next/link";
import { listCameras, type Camera } from "@/lib/dogcam";
import { explainMissingTable } from "@/lib/dogcam-client";
import { dogcamEnabled, isUnlocked } from "@/lib/dogcam-gate";
import { Gate } from "./Gate";
import { NewCameraLink } from "./NewCameraLink";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dog cam",
  description: "A live look at the dog, from whatever device is at home.",
};

/**
 * The hub: which cameras exist, which are awake, and the two things you can do
 * with one -- set a device up as a camera, or watch one.
 */
export default async function DogcamPage() {
  if (!dogcamEnabled()) {
    return (
      <Shell>
        <div className="card space-y-2 p-5">
          <h2 className="font-semibold">The camera section is switched off</h2>
          <p className="text-sm text-muted">
            Set <span className="font-mono">DOGCAM_PASSCODE</span> in your
            environment variables to a passcode of your own and redeploy. Until
            then these pages do nothing, which is the safe way for them to sit
            unused.
          </p>
        </div>
      </Shell>
    );
  }

  if (!isUnlocked()) {
    return (
      <Shell>
        <Gate />
      </Shell>
    );
  }

  let cameras: Camera[] = [];
  let error: string | null = null;
  try {
    cameras = await listCameras();
  } catch (caught) {
    error = explainMissingTable(
      caught instanceof Error ? caught.message : String(caught),
    );
  }

  return (
    <Shell>
      {error && (
        <p
          role="alert"
          className="card border-red-500/40 p-4 text-sm text-red-500"
        >
          {error}
        </p>
      )}

      {!error && cameras.length === 0 && (
        <div className="card space-y-2 p-5">
          <h2 className="font-semibold">No cameras yet</h2>
          <p className="text-sm text-muted">
            Take the device you want to leave at home -- an old phone, a spare
            tablet -- open this page on it, and set it up as a camera. It
            appears here as soon as it does.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {cameras.map((camera) => (
          <li key={camera.slug} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{camera.name}</p>
                <p className="text-sm text-muted">
                  <Dot online={camera.online} />
                  {camera.online
                    ? camera.status.streaming === false
                      ? "On, camera paused"
                      : "Live now"
                    : `Last seen ${when(camera.lastSeenAt)}`}
                </p>
              </div>
              <Link
                href={`/dogcam/watch/${camera.slug}`}
                className={camera.online ? "btn-primary" : "btn"}
              >
                Watch
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <NewCameraLink />

      <div className="card space-y-2 p-4 text-sm text-muted">
        <p className="font-medium text-ink">What this can and cannot do</p>
        <p>
          The picture goes straight from the device at home to the one in your
          hand. Nothing is recorded and no video passes through a server, so
          watching all day costs nothing.
        </p>
        <p>
          The catch is that a web page cannot wake a sleeping tablet or switch
          its camera on from afar. The device at home has to be plugged in,
          awake, and sitting on its camera page. Set Auto-Lock to Never on it
          and leave the page in front -- the camera stops the moment another app
          covers it.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg space-y-4 p-4">
      <header className="pt-2">
        <h1 className="text-xl font-semibold">Dog cam</h1>
        <p className="text-sm text-muted">A live look at whoever is home.</p>
      </header>
      {children}
    </main>
  );
}

function Dot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden
      className={`mr-2 inline-block h-2 w-2 rounded-full ${
        online ? "bg-emerald-500" : "bg-slate-400"
      }`}
    />
  );
}

function when(iso: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "a while ago";
  if (seconds < 90) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
