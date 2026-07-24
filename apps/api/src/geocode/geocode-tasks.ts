/**
 * geocode-tasks cron — the task-address twin of geocode-contacts (#214 Map fix).
 *
 * Tasks carry their OWN structured address (addr_street/unit/city/state/
 * postal_code/country, added by #214 enrichment). This job geocodes that address
 * to lat/lng cached on the task row, via the SAME free, rate-limited Nominatim
 * path contacts use, so the Map view can pin a task at ITS location rather than
 * only the contact's. It is the ONLY writer of tasks.lat/lng/geocoded_at, and
 * (except when it wins the concurrent-edit gate) geocode_status.
 *
 * geocode_status vocabulary (migration 20260724020000_task_geocode.sql, kept in
 * lock-step with the address by the tasks_geocode_status_sync trigger):
 *   'pending'    — address written, never geocoded → this cron attempts it;
 *   'ok'         — geocoded, lat/lng set → TERMINAL (skipped);
 *   'no_address' — no address, or Nominatim found nothing → TERMINAL;
 *   'failed'     — transient error → retried.
 *
 * Idempotent + fair-use, exactly like geocode-contacts: work is STATE-selected
 * ('pending'/'failed'), requests are serialized ≥1s apart, the batch is capped,
 * and the write-back is gated on the address so a concurrent edit wins.
 */
import * as Sentry from "@sentry/cloudflare";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { geocodeAddress, NOMINATIM_MIN_INTERVAL_MS } from "./nominatim";

/** Rows geocoded per run (≈1s each from the fair-use pace); backfill spans runs. */
export const GEOCODE_TASKS_BATCH = 40;

const RETRYABLE_STATUSES = "geocode_status.eq.pending,geocode_status.eq.failed";

interface GeocodableTask {
  id: string;
  addr_street: string | null;
  addr_unit: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  addr_country: string | null;
}

/** Join the structured address columns into a single geocodable query string. */
export function taskAddressQuery(task: GeocodableTask): string {
  return [
    task.addr_street,
    task.addr_unit,
    task.addr_city,
    task.addr_state,
    task.addr_postal_code,
    task.addr_country,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/** Gate an update on the address columns being UNCHANGED (so a concurrent edit
 *  — which the trigger re-queued to 'pending' — wins and the row re-geocodes).
 *  Generic so the caller keeps the PostgREST builder type for `.select()`. */
function whereAddressUnchanged<T>(query: T, task: GeocodableTask): T {
  const cols: [string, string | null][] = [
    ["addr_street", task.addr_street],
    ["addr_unit", task.addr_unit],
    ["addr_city", task.addr_city],
    ["addr_state", task.addr_state],
    ["addr_postal_code", task.addr_postal_code],
    ["addr_country", task.addr_country],
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  for (const [col, val] of cols) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  return q as T;
}

export type Sleeper = (ms: number) => Promise<void>;
const realSleep: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** §11-style scheduled job (env, now); `now` unused (work is state-selected). */
export async function geocodeTasksJob(
  env: Env,
  _now?: Date,
  sleep: Sleeper = realSleep,
): Promise<void> {
  const db: SupabaseClient = getDb(env);

  const { data, error } = await db
    .from("tasks")
    .select(
      "id,addr_street,addr_unit,addr_city,addr_state,addr_postal_code,addr_country",
    )
    // Soft-deleted tasks never appear on the Map (the /v1/tasks feed filters
    // them), so geocoding them is pure waste — and worse, they'd consume the
    // capped batch and the paced Nominatim budget ahead of live tasks. Exclude
    // them, exactly like the contacts twin.
    .is("deleted_at", null)
    .or(RETRYABLE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(GEOCODE_TASKS_BATCH);
  if (error) throw new Error(`geocode task scan failed: ${error.message}`);

  const tasks = (data ?? []) as GeocodableTask[];
  for (const [index, task] of tasks.entries()) {
    const address = taskAddressQuery(task);
    if (!address) continue; // defensive: the trigger keeps address-less rows 'no_address'

    if (index > 0) await sleep(NOMINATIM_MIN_INTERVAL_MS);

    const result = await geocodeAddress(address);
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

    const { error: writeError } = (await whereAddressUnchanged(
      db.from("tasks").update(patch).eq("id", task.id),
      task,
    ).select("id")) as { error: { message: string } | null };
    if (writeError) {
      console.error(
        `geocode cache write failed for task ${task.id}:`,
        writeError.message,
      );
      Sentry.captureMessage(
        `geocode cache write failed for task ${task.id}`,
        "warning",
      );
    }
  }
}
