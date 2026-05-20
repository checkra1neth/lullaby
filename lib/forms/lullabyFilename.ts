/**
 * Build a download filename for a generated lullaby asset (Task 9, Req 13.4).
 *
 * Format: `lullaby-{firstName}-{YYYY-MM-DD}.{ext}`
 *
 * `firstName` is the first whitespace-delimited token of the provided name,
 * lowercased and slugified to ASCII letters/digits with `-` separators.
 * If slugification yields an empty string (e.g. a name made entirely of
 * punctuation or non-Latin script that loses everything to NFKD stripping),
 * we fall back to the literal `child` so the filename is still well-formed.
 *
 * The date stamp is always emitted as `YYYY-MM-DD`. Pass a `Date` (defaults
 * to today in UTC) or a pre-formatted string to keep tests deterministic.
 *
 * The function never reads or logs the original PII — the caller passes the
 * already-known child name from a server-rendered page (Req 18 boundary).
 */
export function lullabyFilename(
  name: string,
  ext: string,
  date: Date | string = new Date(),
): string {
  const firstToken = name.trim().split(/\s+/, 1)[0] ?? "";
  const slug = firstToken
    .toLowerCase()
    .normalize("NFKD")
    // Strip Unicode combining marks (diacritics) left over from NFKD.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const dateStr =
    typeof date === "string" ? date : date.toISOString().slice(0, 10);

  const safeExt = ext.replace(/^\.+/, "").toLowerCase();
  const baseSlug = slug.length > 0 ? slug : "child";

  return `lullaby-${baseSlug}-${dateStr}.${safeExt}`;
}
