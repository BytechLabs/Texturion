/**
 * #428 ask 4: tells the customer that the basemap is not drawing.
 *
 * A tile provider that blocks or rate-limits us returns errors for tile requests
 * and Leaflet leaves those squares blank. Markers still plot and nothing throws,
 * so without a notice the map looks like one with no pins. The threshold below
 * decides when the page shows that notice; it is product behaviour (D147).
 *
 * The PostHog exception sent when the notice first shows is plain instrumentation:
 * the SDK cannot see a blank tile on its own. No retry and no fallback provider,
 * so a silent switch cannot hide that the compliant path is broken.
 */
import { reportClientError } from "@/lib/observability/errors";

/**
 * How many tile errors before it counts as "the basemap is not working".
 *
 * Not one: a single 404 is ordinary — the edge of the world at high zoom, a sea
 * tile a provider does not store, a dropped request on a job-site connection. A map
 * genuinely being refused fails a whole screenful, so the threshold sits above
 * incidental noise and well below a viewport's worth of tiles.
 */
export const TILE_ERROR_THRESHOLD = 6;

/**
 * The PostHog exception for a map whose tiles stopped loading. The tile URL
 * travels under a URL key, so the scrubber cuts the query string where a
 * provider's API key would be.
 */
export function reportTileFailure({
  errors,
  sample,
}: {
  errors: number;
  sample: string | null;
}): void {
  reportClientError(new Error("Basemap tiles are not loading"), {
    tile_errors: String(errors),
    tile_url: sample ?? "none",
  });
}

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
