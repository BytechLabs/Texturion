/**
 * #428 ask 4 — a map that stops drawing tiles must be visible to US, not just to
 * the customer.
 *
 * THE FAILURE SHAPE. A tile provider that blocks or rate-limits us returns errors
 * for tile requests, and Leaflet's answer is to leave those squares blank. Markers
 * still plot, the page still loads, nothing throws. A blocked basemap is
 * indistinguishable from a map with no pins — which is precisely how the OSM
 * violation could have run for months without anybody noticing, and it is the same
 * absence-shaped failure #387 exists for.
 *
 * WHAT THIS IS NOT. It is not a retry, and it is not a fallback to another
 * provider. Leaflet already retries as the user pans, and a silent fallback would
 * recreate the original problem (the compliant path becoming the one nobody is on).
 * The only job here is to NOTICE.
 *
 * WHY IT REPORTS ONCE PER SESSION. A blocked provider fails every tile in the
 * viewport, so a naive reporter would send dozens of identical events per pan and
 * turn an outage into a telemetry bill. One report per page carries the same
 * information: the provider is not serving us.
 */

/**
 * How many tile errors before it counts as "the basemap is not working".
 *
 * Not one: a single 404 is ordinary — the edge of the world at high zoom, a sea
 * tile a provider does not store, a dropped request on a job-site connection. A map
 * genuinely being refused fails a whole screenful, so the threshold sits above
 * incidental noise and well below a viewport's worth of tiles.
 */
export const TILE_ERROR_THRESHOLD = 6;

export interface TileHealthReporter {
  /** Called once, when the threshold is first crossed. */
  onUnhealthy: (info: { errors: number; sample: string | null }) => void;
}

/**
 * Counts tile failures and reports the first time they stop looking incidental.
 *
 * Deliberately a tiny stateful object rather than a hook: Leaflet's tile events are
 * imperative, and this has to be callable from an event handler without dragging a
 * render cycle behind it.
 */
export function createTileHealth(reporter: TileHealthReporter) {
  let errors = 0;
  let reported = false;
  let sample: string | null = null;

  return {
    /** Call from Leaflet's `tileerror`. */
    recordError(tileUrl?: string) {
      errors += 1;
      if (sample === null && tileUrl) sample = tileUrl;
      if (reported || errors < TILE_ERROR_THRESHOLD) return;
      reported = true;
      reporter.onUnhealthy({ errors, sample });
    },

    /**
     * There is deliberately NO `recordLoad`, and no success path resets the count.
     *
     * A provider that serves some tiles and refuses others is still a provider with
     * a problem we want to hear about, and resetting on success would let a
     * half-broken basemap sit under the threshold forever — which is the silent
     * state this whole file exists to end.
     */

    /** For tests and for the notice: has the basemap been declared unhealthy? */
    get unhealthy() {
      return reported;
    },

    get errorCount() {
      return errors;
    },
  };
}
