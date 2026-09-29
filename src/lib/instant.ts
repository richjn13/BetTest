/**
 * Reading a moment in time out of a form.
 *
 * A browser's `datetime-local` box hands over "2026-09-20T13:00" with no zone
 * attached, and a bare string like that is parsed in whatever zone the reader
 * happens to be in -- UTC on a server. An afternoon kickoff typed in New York
 * was stored four hours early that way, which closed picks early, froze the
 * line early and showed the game as under way hours before it was.
 *
 * So a time only counts here when it says which zone it is in. The forms
 * convert in the browser, where the zone and its daylight-saving rules are
 * known; this is the guard that keeps a naive string from ever being guessed
 * at again.
 */

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseInstant(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "" || !HAS_ZONE.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
