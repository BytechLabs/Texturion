import * as Sentry from "@sentry/cloudflare";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * #240 item 2 — the tripwire that decides when storage starts costing us
 * anything at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A TRIPWIRE HERE AND NOT A TIERING IMPLEMENTATION.
 *
 * #240 asked for cold objects to move to a cheaper storage tier. Two findings,
 * both dated 2026-08-04:
 *
 *   1. THE VENDOR CANNOT DO IT. Supabase Storage's S3 compatibility page marks
 *      GetBucketLifecycleConfiguration and PutBucketLifecycleConfiguration
 *      unimplemented, and PutObject's `x-amz-storage-class` unsupported. There
 *      is no lifecycle rule and no storage class to move an object into. The
 *      only way to tier would be a SECOND storage vendor — a new subprocessor
 *      with its own DPA, a second signing path, a second deletion contract to
 *      keep in step with #284 and #227, and a second place for the sweep to be
 *      wrong.
 *
 *   2. THERE IS NOTHING TO TIER. Measured against production the same day: 2
 *      live note attachments totalling 990 KB and 4 MMS media totalling 1.1 MB,
 *      across 3 workspaces — 0.0009 GB against the 100 GB Supabase Pro
 *      includes. Storage costs us nothing, and would keep costing nothing after
 *      a hundred thousand times as much.
 *
 * So the honest engineering answer is not to build it, and the thing worth
 * building instead is the number that says when that answer expires. Without
 * one, "we looked at this and it was not worth it" decays into folklore and
 * somebody re-derives it from scratch in a year — or worse, nobody does, and
 * the first sign is a bill.
 *
 * *This is the same discipline as the carrier-ceiling and inference-location
 * constants: a fact, the date it was checked, and the trigger to check again.*
 */

/**
 * What Supabase Pro includes, in GB. Crossing it is the moment a stored byte
 * starts costing money rather than nothing.
 *
 * Verified on supabase.com/pricing, 2026-08-04. It is the threshold and not an
 * alarm: at 100 GB the overage is ~$0.021/GB-month, so the first month past it
 * costs cents. What matters is that somebody KNOWS, because it is also the
 * moment deduplication and a second storage tier stop costing more than they
 * save.
 */
export const SUPABASE_INCLUDED_STORAGE_GB = 100;
export const SUPABASE_STORAGE_VERIFIED_ON = "2026-08-04";

/**
 * Fleet-wide stored bytes across both attachment tables, live rows only.
 *
 * A separate read from the per-company arm rather than a sum of it: the
 * per-company loop is capped per run (USAGE_ALERTS_BATCH), so adding up what it
 * happened to visit would quietly under-report exactly as the fleet grew past
 * the point where the number matters.
 */
export async function fleetStoredBytes(env: Env): Promise<number> {
  const db = getDb(env);
  const { data, error } = await db.rpc("api_fleet_stored_bytes");
  if (error) {
    throw new Error(`fleet storage read failed: ${error.message}`);
  }
  return Number(data ?? 0);
}

/**
 * Tell ops once when the fleet crosses the included allowance.
 *
 * Deliberately NOT a customer-facing anything: D34 made storage free to the
 * customer and this is our cost, not theirs. Deliberately not a cap either —
 * capping storage is the thing D34 explicitly took off the table.
 *
 * Idempotence rides Sentry rather than the usage_alerts ledger, because that
 * ledger is keyed on (company, period) and this is neither. A message a month
 * about a threshold nobody has crossed in a year is the right trade against
 * inventing a fleet-scoped ledger table for one boolean.
 */
export async function checkFleetStorage(env: Env): Promise<void> {
  const bytes = await fleetStoredBytes(env);
  const gb = bytes / 1024 ** 3;
  if (gb < SUPABASE_INCLUDED_STORAGE_GB) return;

  const text =
    `Stored attachments across the whole fleet have reached ` +
    `${gb.toFixed(1)} GB, past the ${SUPABASE_INCLUDED_STORAGE_GB} GB included ` +
    `in Supabase Pro (checked ${SUPABASE_STORAGE_VERIFIED_ON}).\n\n` +
    `Nothing is broken and nothing is capped — D34 keeps storage free to the ` +
    `customer on purpose. This is the point where two things in #240 that were ` +
    `deliberately not built become worth building:\n\n` +
    `  - Deduplication of identical objects across a workspace.\n` +
    `  - Moving cold objects to a cheaper tier, which needs a second storage ` +
    `vendor: Supabase Storage supports neither lifecycle rules nor storage ` +
    `classes.\n\n` +
    `Run \`node scripts/ops/storage-report.mjs\` to see which workspaces are ` +
    `carrying it, ranked by what they actually cost.`;

  Sentry.captureMessage(
    `fleet storage past the included allowance: ${gb.toFixed(1)} GB`,
    "warning",
  );
  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `Fleet storage is past the included ${SUPABASE_INCLUDED_STORAGE_GB} GB`,
    text,
    html: renderEmailHtml(text),
  });
}
