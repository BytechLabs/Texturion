/**
 * Nominatim / OpenStreetMap geocoding client (HOME-AND-VIEWS.md D25).
 *
 * The Map view plots each task at its contact's address. We geocode a
 * contact's free-text address to lat/lng ONCE and cache the result on the
 * contacts row (lat/lng/geocoded_at/geocode_status). Map rendering itself is
 * free OSM raster tiles (Leaflet, client-side) and makes NO paid call — only
 * this geocode does, once per address.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * is honored here: at most 1 request/second (the CALLER serializes + paces —
 * see geocode-contacts.ts), a descriptive `User-Agent` identifying the app,
 * and attribution "© OpenStreetMap contributors" shown on the map (a UI
 * concern, documented for the frontend track). If volume ever outgrows the
 * fair-use policy the client swaps to a keyed geocoder behind THIS interface;
 * display stays free OSM tiles (D25).
 *
 * This module is the network edge tests stub — raw `fetch`, no dependency.
 */

/** Public Nominatim endpoint (no key). Overridable for a keyed swap (D25). */
export const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * Identifies JobText to the OSM operators per the Nominatim policy (a real
 * contact address is required by the policy; this is the app's own domain).
 */
export const NOMINATIM_USER_AGENT =
  "JobText/1.0 (+https://jobtext.app; geocoding@jobtext.app)";

/** Nominatim fair-use pace: at most one request per second (D25). */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

/** One resolved coordinate. */
export interface GeocodeHit {
  lat: number;
  lng: number;
}

/**
 * Outcome of a single geocode attempt (the raw geocoder verdict — the cron
 * maps these to the committed `contacts.geocode_status` vocabulary):
 *   - 'ok'        — a usable lat/lng was found;
 *   - 'not_found' — Nominatim returned zero results for the address (a real,
 *                   terminal answer — the contact has no placeable location and
 *                   must NOT be retried every run);
 *   - 'failed'    — a transient error (network, non-2xx, unparseable) — safe to
 *                   retry on a later run.
 */
export type GeocodeResult =
  | { status: "ok"; hit: GeocodeHit }
  | { status: "not_found" }
  | { status: "failed"; reason: string };

interface NominatimRow {
  lat?: string;
  lon?: string;
}

/**
 * Geocode one free-text address via Nominatim `/search` (json, limit 1).
 * Never throws: every failure is folded into a `GeocodeResult` so the batch
 * cron can record a per-contact status and move on. The caller is responsible
 * for the 1 req/s pacing (this function issues exactly one HTTP request).
 */
export async function geocodeAddress(
  address: string,
): Promise<GeocodeResult> {
  const query = address.trim();
  if (query === "") return { status: "not_found" };

  const url = new URL("/search", NOMINATIM_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  // Bias to the ICP's geography (US/CA, D2/D25). `countrycodes` is a filter,
  // not a hard requirement Nominatim can misread, so an out-of-region address
  // simply yields no hit (→ not_found) rather than a wrong pin.
  url.searchParams.set("countrycodes", "us,ca");

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        // Policy-required identifying UA; JSON accept keeps the body small.
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch (cause) {
    return {
      status: "failed",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (!response.ok) {
    // 429/5xx from Nominatim are transient — retryable next run.
    return { status: "failed", reason: `nominatim http ${response.status}` };
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return { status: "failed", reason: "nominatim returned unparseable JSON" };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: "not_found" };
  }

  const first = rows[0] as NominatimRow;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // A row with no usable coordinate is a real "no location" answer.
    return { status: "not_found" };
  }
  return { status: "ok", hit: { lat, lng } };
}
