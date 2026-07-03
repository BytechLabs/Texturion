/**
 * geocode-contacts cron job (HOME-AND-VIEWS.md D25 — "a small queue/cron for
 * backfill and rate-limiting").
 *
 * Selects contacts that have a street address but no cached coordinate yet
 * (or a previous transient failure), geocodes each via Nominatim, and caches
 * the result on the row: lat/lng/geocoded_at/geocode_status. It is the ONLY
 * writer of those four columns.
 *
 * `geocode_status` is the committed vocabulary (migration
 * 20260702060000_appv2_tasks_attachments_geocode.sql):
 *   'pending'    — never attempted (the default; set by the route when an
 *                  address is written) → this cron retries it;
 *   'ok'         — geocoded, lat/lng set → TERMINAL (skipped);
 *   'no_address' — no placeable location (route sets it when the address is
 *                  cleared; this cron sets it when Nominatim returns zero
 *                  results for a present address) → TERMINAL (skipped, no map pin);
 *   'failed'     — a transient error (network / non-2xx / unparseable) → retried.
 *
 * Idempotency + fair-use (D25):
 *   - Work is selected by STATE ('pending' or 'failed'), never by "last run"
 *     bookkeeping — re-running is safe.
 *   - 'ok' and 'no_address' are TERMINAL: a geocoded contact and one Nominatim
 *     has no result for are both skipped on every later run (the "skip
 *     already-geocoded" requirement).
 *   - Requests are SERIALIZED and paced at ≥1s apart (NOMINATIM_MIN_INTERVAL_MS)
 *     to honor Nominatim's 1 req/s policy; the batch is capped per run.
 *   - Re-geocoding after an address EDIT is triggered by the write path
 *     resetting the row to geocode_status='pending' (routes/contacts.ts), so
 *     this cron re-picks it up — the cron never diffs addresses itself.
 */
import * as Sentry from "@sentry/cloudflare";

import { getDb } from "../db";
import type { Env } from "../env";
import { geocodeAddress, NOMINATIM_MIN_INTERVAL_MS } from "./nominatim";

/**
 * Rows geocoded per run. Bounded so a single trigger's wall-clock (≈1s/row
 * from the fair-use pacing) stays well inside a cron invocation and the OSM
 * budget stays modest. Backfill of a large address book spans several runs.
 */
export const GEOCODE_BATCH = 40;

interface GeocodableContact {
  id: string;
  address: string | null;
}

/**
 * The status values this cron re-attempts: 'pending' (never geocoded — the
 * default the route stamps on an address write) and 'failed' (a prior transient
 * error). 'ok' and 'no_address' are terminal and excluded, so the scan is
 * self-limiting as the backfill completes.
 */
const RETRYABLE_STATUSES =
  "geocode_status.eq.pending,geocode_status.eq.failed";

/**
 * Sleep helper injected with the runtime timer. Tests override it to run the
 * pacing loop without real-time waits.
 */
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * §11-style scheduled job signature (env, now) — `now` is unused (work is
 * state-selected, not time-windowed) but kept for the CRON_JOBS contract. The
 * `sleep` param defaults to a real timer; tests pass a no-op.
 */
export async function geocodeContactsJob(
  env: Env,
  _now?: Date,
  sleep: Sleeper = realSleep,
): Promise<void> {
  const db = getDb(env);

  // Company-agnostic scan (this is a system cron, not a member request — it
  // runs across all tenants). Select only rows with an address that still
  // need geocoding; deleted contacts never appear on the map, so exclude them.
  const { data, error } = await db
    .from("contacts")
    .select("id,address")
    .is("deleted_at", null)
    .not("address", "is", null)
    .or(RETRYABLE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(GEOCODE_BATCH);
  if (error) {
    throw new Error(`geocode contact scan failed: ${error.message}`);
  }

  const contacts = (data ?? []) as GeocodableContact[];
  for (const [index, contact] of contacts.entries()) {
    const address = contact.address?.trim();
    if (!address) continue; // defensive: the query already excludes null

    // Pace between requests (not before the first): ≥1s apart per Nominatim
    // policy. Serialized by the for-await loop.
    if (index > 0) await sleep(NOMINATIM_MIN_INTERVAL_MS);

    const result = await geocodeAddress(address);

    // Map the geocoder verdict onto the committed geocode_status vocabulary and
    // build the cache write. lat/lng are set only on a hit; geocoded_at stamps
    // every attempt so the row's freshness is visible. A 'failed' result leaves
    // lat/lng untouched and keeps the row retryable; 'no_address' (Nominatim
    // returned nothing for a present address) is terminal — no map pin.
    const status =
      result.status === "ok"
        ? "ok"
        : result.status === "not_found"
          ? "no_address"
          : "failed";
    const patch: Record<string, unknown> = {
      geocode_status: status,
      geocoded_at: new Date().toISOString(),
    };
    if (result.status === "ok") {
      patch.lat = result.hit.lat;
      patch.lng = result.hit.lng;
    }

    // Conditional write-back: only cache the result if the row's address is
    // still the one we geocoded. A concurrent edit (routes/contacts.ts) that
    // changed the address reset geocode_status to 'pending' under us; writing
    // this coordinate would cache it against the STALE address and — because we
    // also stamp a terminal status — the row would never be re-geocoded. Gating
    // on the captured address makes the edit win: our update matches zero rows,
    // the row stays 'pending', and the next run re-geocodes the new address.
    const { data: written, error: writeError } = await db
      .from("contacts")
      .update(patch)
      .eq("id", contact.id)
      .eq("address", contact.address)
      .select("id");
    if (writeError) {
      // A cache-write failure is not fatal to the batch — log and continue so
      // one bad row never starves the rest; the row stays retryable.
      console.error(
        `geocode cache write failed for contact ${contact.id}:`,
        writeError.message,
      );
      Sentry.captureMessage(
        `geocode cache write failed for contact ${contact.id}`,
        "warning",
      );
    } else if ((written ?? []).length === 0) {
      // No row matched: the address changed under us (a concurrent edit reset
      // the row to 'pending'). We deliberately did NOT cache — the row stays
      // retryable and the next run geocodes the current address.
      console.info(
        `geocode skipped stale write for contact ${contact.id} (address changed under the cron)`,
      );
    }
  }
}
