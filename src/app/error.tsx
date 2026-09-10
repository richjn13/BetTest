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
        On a new deployment this is almost always a missing or mistyped
        environment variable.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/setup" className="btn-primary">
          Run the setup check
        </Link>
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
