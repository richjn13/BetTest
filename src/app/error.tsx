"use client";

import Link from "next/link";

/**
 * Replaces Next's bare "server-side exception" page. On a fresh deployment the
 * cause is nearly always configuration, so point at the check that finds it
 * rather than at a server log the reader may have no easy way to open.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Something broke</h1>

      <p className="mt-2 text-muted">
        <strong className="text-ink">If the app was just updated, reload the page.</strong>{" "}
        A tab opened before an update is still talking to the old version, and
        the button you pressed no longer exists on the server. A reload fixes
        it, and nothing was saved.
      </p>
      <p className="mt-2 text-muted">
        Otherwise the two usual causes are a database migration that was never
        run, and a missing or mistyped environment variable. The setup check
        finds both and names the file or the variable.
      </p>

      {error.message && (
        <p className="mt-3 break-words rounded-lg border border-edge px-3 py-2 font-mono text-xs text-muted">
          {error.message}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/setup" className="btn-primary">
          Run the setup check
        </Link>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn"
        >
          Reload the page
        </button>
        <button type="button" onClick={reset} className="btn">
          Try again
        </button>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-muted">
          Error reference{" "}
          <span className="font-mono">{error.digest}</span>. Search for it in
          your Vercel project&apos;s Logs tab to see the full message.
        </p>
      )}
    </main>
  );
}
