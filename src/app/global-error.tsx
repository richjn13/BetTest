"use client";

/**
 * Last-resort boundary, used when the root layout itself fails. It has to
 * render its own html and body, and it cannot rely on the app's styles.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "64px 20px",
          lineHeight: 1.6,
        }}
      >
        <main style={{ maxWidth: 480, margin: "0 auto" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something broke</h1>
          <p style={{ margin: "0 0 20px" }}>
            On a new deployment this is almost always a missing or mistyped
            environment variable.
          </p>
          <p style={{ margin: "0 0 20px" }}>
            <a href="/setup">Run the setup check</a>
          </p>
          {error.digest && (
            <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
              Error reference <code>{error.digest}</code>. Search for it in your
              Vercel project&apos;s Logs tab to see the full message.
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
