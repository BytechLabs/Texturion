/**
 * #428 — where map tiles come from, and the one rule about it.
 *
 * THE VIOLATION THIS REPLACES. The Map view served
 * `tile.openstreetmap.org` — the OpenStreetMap Foundation's own infrastructure,
 * run on donated resources. Their Tile Usage Policy exists for OSM's own use and
 * light third-party use, prohibits heavy use, and requires permission for
 * commercial applications. We are a paid product, and every customer who opened
 * the Map view drew from a courtesy service. The attribution was correct; the
 * source was not ours to use.
 *
 * The failure mode made it worse: the OSMF blocks by user-agent and referrer, and
 * a blocked map simply stops drawing tiles. Markers still plot, nothing throws.
 * That is the #387 shape — a third party changing a fact about us with no state on
 * our side to record it — and it arrives exactly when the feature is being used
 * most.
 *
 * THE RULE: WE FAIL TOWARD NO BASEMAP, NEVER TOWARD SOMEBODY ELSE'S GOODWILL.
 * With no commercial tile provider configured, the map renders pins on an empty
 * ground and says why. That is a worse map and an honest one. Quietly keeping the
 * OSM URL as a fallback would mean the compliant path is the one nobody is on,
 * which is how this got here.
 *
 * CONFIGURING IT IS ONE ENV VAR. `NEXT_PUBLIC_MAP_TILE_URL` (plus the matching
 * `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`) switches the basemap on. Any provider whose
 * terms permit a paid product to serve their tiles works — the requirement is a
 * URL template and correct attribution, not an architecture change. See
 * `docs/MAP-TILES.md` for what to pick and what its ceiling is.
 *
 * WHY THE ATTRIBUTION IS ALSO CONFIGURED, rather than hardcoded. Nearly every
 * provider requires crediting BOTH themselves and OpenStreetMap where OSM data
 * underlies their tiles, and the exact string is theirs to dictate. A hardcoded
 * credit would be wrong for whichever provider is chosen — and an attribution
 * that names the wrong party is a second licensing problem, not a cosmetic one.
 */

/**
 * A configured basemap, or null when none is.
 *
 * `null` is a first-class state rather than an error: the Map view is useful
 * without a basemap (pins, clustering, "you are here" all still work), so the
 * absence degrades one layer instead of failing the feature.
 */
export interface Basemap {
  /** Leaflet URL template, e.g. `https://…/{z}/{x}/{y}.png?key=…`. */
  url: string;
  /** The provider's required credit line. HTML, rendered by Leaflet. */
  attribution: string;
  maxZoom: number;
}

/** Leaflet's default; overridden per provider via NEXT_PUBLIC_MAP_TILE_MAX_ZOOM. */
const DEFAULT_MAX_ZOOM = 19;

/**
 * Read the configured basemap.
 *
 * Both the URL and the attribution are required together. A URL with no
 * attribution is the licensing problem this issue is about wearing a different
 * provider's name, so a half-configured basemap is treated as no basemap — and
 * that is deliberately strict: the failure it prevents is the one nobody notices.
 */
export function readBasemap(env: {
  NEXT_PUBLIC_MAP_TILE_URL?: string;
  NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?: string;
  NEXT_PUBLIC_MAP_TILE_MAX_ZOOM?: string;
}): Basemap | null {
  const url = env.NEXT_PUBLIC_MAP_TILE_URL?.trim();
  const attribution = env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim();
  if (!url || !attribution) return null;

  // A provider we are NOT licensed to use cannot be configured back in by
  // accident — a copied .env, a tutorial, a well-meant "restore the map" fix.
  // This is the whole point of the module: the violation has to be impossible to
  // reintroduce quietly, not merely removed once.
  if (isUnlicensedTileHost(url)) return null;

  const parsedMaxZoom = Number(env.NEXT_PUBLIC_MAP_TILE_MAX_ZOOM);
  return {
    url,
    attribution,
    maxZoom:
      Number.isFinite(parsedMaxZoom) && parsedMaxZoom > 0
        ? Math.floor(parsedMaxZoom)
        : DEFAULT_MAX_ZOOM,
  };
}

/**
 * Hosts we must not serve tiles from, whatever the config says.
 *
 * `tile.openstreetmap.org` and its subdomains are the OSMF's donated
 * infrastructure. Nothing else belongs on this list yet: it is not a general
 * blocklist, it is the specific mistake #428 documents, made unrepeatable.
 */
export function isUnlicensedTileHost(url: string): boolean {
  // Matches the bare host and the {s}. / a. / b. / c. subdomain forms Leaflet
  // templates use, without being fooled by a lookalike domain that merely
  // CONTAINS the string (evil-tile.openstreetmap.org.example.com).
  return /(^|\/\/)([^/]*\.)?tile\.openstreetmap\.org(\/|$)/i.test(url);
}

/**
 * What the Map view tells the crew when there is no basemap.
 *
 * Names the state and who fixes it, and does NOT apologise for a bug — this is a
 * configuration the workspace's owner can complete, not a fault. Deliberately
 * short: it sits under a working map, not in place of one.
 */
export const NO_BASEMAP_NOTICE =
  "Job pins are exact. The street background needs a map provider configured, " +
  "which an owner can do in one setting.";
