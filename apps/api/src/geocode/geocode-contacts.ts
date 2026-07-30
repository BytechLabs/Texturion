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
 * Rows geocoded per run. Bounded so a single trigger's wall-clock (≈1s/row from
 * the fair-use pacing) stays well inside a cron invocation.
 *
 * #440 RAISED THIS FROM 40, AND THE ARITHMETIC IS WORTH WRITING DOWN because the
 * issue's own framing of it was slightly off. 40 rows per hourly run is 960/day,
 * so a 2,000-contact import — which is what the CSV importer exists for, and
 * which every switcher does exactly once, at the moment of maximum scrutiny —
 * took more than two days with an empty Map and nothing saying why.
 *
 * The tempting reading is "40 requests in an hour is 1% of a 1/s allowance, so
 * there is 100× headroom". That confuses the average with the cap. Nominatim's
 * policy caps the RATE, and this loop already runs AT that rate while it runs;
 * what is low is the DUTY CYCLE. Raising the batch buys more seconds at 1/s, it
 * does not buy a higher rate.
 *
 * So this went to 120, not to 600. 120 rows is ≈2 minutes of wall clock — still
 * comfortably inside a cron invocation — and 2,880/day, which turns two days into
 * about seventeen hours. It deliberately stops well short of what the wall clock
 * would allow, because Nominatim's policy also asks heavy users to self-host, and
 * per #428 the mistake being corrected elsewhere in this codebase is exactly
 * "lean harder on an OSM courtesy service because it has not complained yet".
 *
 * The real fix for the customer moment was not this number. It was the ORDERING
 * (api_geocode_contact_queue: fair share per company, nearly-finished workspaces
 * first) which costs the upstream service nothing, plus telling the customer what
 * is happening. This is the smallest defensible improvement on top of those.
 */
export const GEOCODE_BATCH = 120;

/**
 * Rows any ONE workspace may take from a single run.
 *
 * The starvation fix. The old query ordered by `created_at asc` across every
 * tenant, so the oldest pending rows in the system went first — and a workspace
 * that imported today has the NEWEST rows, so it queued behind everybody else's
 * backlog. One established address book with a trickle of failures could hold a
 * brand-new workspace at the back of the line indefinitely.
 *
 * A seat cap means every workspace with work pending progresses on every run.
 * Sized so a single workspace still finishes a 2,000-row import in a sensible
 * number of runs when nobody else is queued (the queue hands out unclaimed seats
 * to whoever is left, so a lone tenant still gets the whole batch).
 */
export const GEOCODE_PER_COMPANY = 40;

interface GeocodableContact {
  id: string;
  address: string | null;
}

/**
 * WHICH STATUSES ARE RE-ATTEMPTED now lives in `api_geocode_contact_queue`
 * alongside the ordering, and there is no constant here any more.
 *
 * The rule is unchanged: 'pending' (never geocoded — the default the route stamps
 * on an address write) and 'failed' (a prior transient error) are re-attempted;
 * 'ok' and 'no_address' are terminal, so the queue is self-limiting as the
 * backfill completes. GF-4 asserts the SQL predicate and this comment agree, which
 * is the only thing that keeps a comment like this true.
 */

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

  // #440: the queue is an RPC now, not a flat scan, because the ordering IS the
  // fix. It fair-shares seats across workspaces and serves the nearly-finished
  // ones first, so a switcher's fresh import cannot queue behind every other
  // tenant's backlog. The predicates live in SQL beside the ordering, and
  // `geocode_fair_share.test.sql` GF-4 asserts they still select exactly what this
  // cron means to geocode.
  const { data, error } = await db.rpc("api_geocode_contact_queue", {
    p_limit: GEOCODE_BATCH,
    p_per_company: GEOCODE_PER_COMPANY,
  });
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
