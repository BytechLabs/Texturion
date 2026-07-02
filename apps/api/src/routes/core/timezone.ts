/**
 * IANA timezone validation for companies.timezone writes (D15). The runtime's
 * own timezone database is the source of truth: a zone is valid when
 * Intl.DateTimeFormat accepts it. ECMA-402 also accepts bare offsets ("+05:00")
 * and non-IANA spellings; the shape check keeps the column to real IANA zone
 * names ("Area/Location", plus the canonical "UTC").
 */
export function isValidIanaTimezone(timezone: string): boolean {
  if (timezone !== "UTC" && !timezone.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
