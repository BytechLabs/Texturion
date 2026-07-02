/**
 * Grouped IANA timezone options for the Settings → Workspace select (D15).
 * The runtime's own zone database (Intl.supportedValuesOf) is the source —
 * never a hardcoded list — grouped by IANA area ("America", "Europe", …) for
 * a scannable, searchable picker. Pure functions, unit-tested directly.
 */

export interface TimezoneGroup {
  region: string;
  zones: string[];
}

/** "America/St_Johns" → "America/St Johns" (display only). */
export function timezoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

/**
 * Group zone names by their IANA area (the segment before the first "/").
 * Region-less names (UTC and legacy aliases some runtimes list) collect under
 * "Other". Regions and zones are sorted alphabetically; "America" regions are
 * NOT special-cased — search is the fast path for this ICP.
 */
export function groupTimezones(zones: readonly string[]): TimezoneGroup[] {
  const byRegion = new Map<string, string[]>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const region = slash === -1 ? "Other" : zone.slice(0, slash);
    const list = byRegion.get(region) ?? [];
    list.push(zone);
    byRegion.set(region, list);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([region, list]) => ({
      region,
      zones: [...list].sort((a, b) => a.localeCompare(b)),
    }));
}

/** The browser's full IANA zone list (empty on very old runtimes). */
export function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}
