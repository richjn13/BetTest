/**
 * Circular avatar, falling back to initials so a row never collapses when
 * somebody has not uploaded a picture.
 */
export function Avatar({
  username,
  avatarUrl,
  size = 32,
}: {
  username: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const initials = username.trim().slice(0, 2).toUpperCase();

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full
                 border border-edge bg-raised align-middle"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimise
        <img src={avatarUrl} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <span
          className="font-semibold text-muted"
          style={{ fontSize: Math.max(10, Math.round(size * 0.38)) }}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
