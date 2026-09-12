"use client";

import Link from "next/link";

/**
 * Replaces Next's bare "server-side exception" page.
 *
 * Two very different failures land here and they need different advice. A
 * request that never completed -- the browser's own fetch failing -- says
 * nothing about the server and may well have left the work finished. Anything
 * else, on a fresh deployment, is nearly always configuration or a migration
 * that was never run, so it points at the check that finds both.
 */

/** Every browser words a failed fetch differently, and none of them usefully. */
const NETWORK = [
  "load failed", // Safari
  "failed to fetch", // Chrome
  "networkerror", // Firefox
  "network connection was lost",
  "connection appears to be offline",
];

function isNetworkFailure(message: string): boolean {
  const text = message.toLowerCase();
  return NETWORK.some((phrase) => text.includes(phrase));
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const offline = isNetworkFailure(error.message ?? "");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {offline ? "That didn't get through" : "Something broke"}
      </h1>

      {offline ? (
        <>
          <p className="mt-2 text-muted">
            The browser could not finish talking to the server. That is a
            dropped connection, a phone changing networks, or a deployment
            landing mid-request. It is not a fault in your pool&apos;s data.
          </p>
          <p className="mt-2 text-muted">
            <strong className="text-ink">
              If you had just pressed a button, check before pressing it again.
            </strong>{" "}
            The request may have reached the server and finished anyway, with
            only the reply lost. Reload, look at whether the work is done, and
            only then try once more.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-muted">
            <strong className="text-ink">If the app was just updated, reload the page.</strong>{" "}
            A tab opened before an update is still talking to the old version,
            and the button you pressed no longer exists on the server. A reload
            fixes it, and nothing was saved.
          </p>
          <p className="mt-2 text-muted">
            Otherwise the two usual causes are a database migration that was
            never run, and a missing or mistyped environment variable. The setup
            check finds both and names the file or the variable.
          </p>
        </>
      )}

      {error.message && (
        <p className="mt-3 break-words rounded-lg border border-edge px-3 py-2 font-mono text-xs text-muted">
          {error.message}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={offline ? "btn-primary" : "btn"}
        >
          Reload the page
        </button>
        <Link href="/setup" className={offline ? "btn" : "btn-primary"}>
          Run the setup check
        </Link>
        <button type="button" onClick={reset} className="btn">
          Try again
        </button>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-muted">
          Error reference <span className="font-mono">{error.digest}</span>.
          Search for it in your Vercel project&apos;s Logs tab to see the full
          message.
        </p>
      )}
    </main>
  );
}
