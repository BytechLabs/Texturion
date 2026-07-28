/**
 * #387 — the capability to notice that an expected thing did NOT happen.
 *
 * Sentry answers "what threw?". Nine open issues share a different shape: the
 * carrier accepted the message and dropped it, Resend accepted the request and
 * the mailbox bounced it, the cron simply did not fire. Nothing throws, because
 * the defining characteristic is that nothing occurred — and silence reads
 * exactly like health.
 *
 * ONE mechanism, not nine detectors. Everything here is a heartbeat:
 *
 *   - a CRON records its heartbeat by firing. `scheduled()` in index.ts is the
 *     single choke point every trigger passes through, so this cannot be
 *     forgotten per-job the way a convention would be.
 *   - a DELIVERY CHANNEL gets its heartbeat either from a probe the checker
 *     runs or from the send path itself. Same ledger, same alert path — a
 *     probe is just a heartbeat somebody else observes.
 *
 * DECLARATION IS MANDATORY AT THE POINT OF DEFINITION, and the compiler is
 * what enforces it: `CronSchedule` below is derived from the `cron:` keys of
 * this table, and `CRON_JOBS` in index.ts is typed by it. A schedule added to
 * wrangler.jsonc without an expectation here does not typecheck. That is the
 * same structural move as `AiFeatureSpec.key` being typed to priced keys — the
 * guard lives where the thing is declared, never in a doc somebody must
 * remember (#377, #380, #385).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

export interface LivenessExpectation {
  /** One sentence, in the alert's voice: what did not happen. */
  what: string;
  /** How often this is supposed to occur, at minimum. */
  everyMinutes: number;
  /**
   * How long past the cadence before we shout.
   *
   * Per-expectation because a once-a-minute sweeper and a once-a-day reconcile
   * do not deserve the same patience, and because a grace that is too tight
   * produces false alarms — which cost more than the outage, since they are
   * how a founder learns to ignore this mailbox.
   */
  graceMinutes: number;
}

/**
 * Every liveness key in the product.
 *
 * `cron:` keys mirror wrangler.jsonc exactly. `channel:` keys are the two
 * delivery paths #387 names, and they are observed differently on purpose:
 *
 *   - SMS is PROBED from the messages table by the checker. A heartbeat write
 *     per text would put a database round-trip on the hot path of every
 *     inbound webhook, to learn something one query an hour answers just as
 *     well.
 *   - EMAIL is RECORDED by `sendEmail` itself, because it is low volume and
 *     there is no table to read — nothing anywhere records that an email was
 *     sent, which is half of why #386 can happen at all.
 *
 * Both land in the same ledger and the same alert path. The asymmetry is in
 * how the occurrence is observed, never in what it means.
 */
export const LIVENESS_EXPECTATIONS = {
  "cron:* * * * *": {
    what: "The unanswered-lead escalation scan (#388) has not run.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "cron:*/5 * * * *": {
    what: "The webhook sweeper has not run — unprocessed provider webhooks are not being replayed.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "cron:*/15 * * * *": {
    what: "Provisioning retry, reconcile and due-task reminders have not run.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "cron:0 * * * *": {
    what: "The hourly usage re-reporter has not run — usage is not reaching Stripe.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "cron:30 * * * *": {
    what: "The sole-proprietor OTP nudge has not run.",
    everyMinutes: 60,
    graceMinutes: 90,
  },
  "cron:20 * * * *": {
    what: "The contact geocoding backfill has not run.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "cron:40 * * * *": {
    what: "The task-address geocoding backfill has not run.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "cron:0 13 * * *": {
    what: "The daily registration poller has not run — 10DLC/A2P status is not being reconciled.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:10 13 * * *": {
    what: "The daily port reconcile has not run — in-flight number ports are unattended.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:0 14 * * *": {
    what: "The daily grace-and-release job has not run.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:0 15 * * *": {
    what: "The daily subscription reconcile has not run — billing state may be drifting from Stripe.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:45 15 * * *": {
    what: "The daily opt-out reconciliation against the carrier list has not run (#331).",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:30 15 * * *": {
    what: "The daily webhook_events retention sweep has not run.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:50 13 * * 1": {
    what: "The weekly founder cost digest has not run (#447).",
    everyMinutes: 10080,
    graceMinutes: 1440,
  },
  "channel:sms-outbound": {
    what:
      "No outbound text has been accepted by the carrier across the entire platform. " +
      "Either nobody is texting, or sending is broken and every workspace is silent.",
    everyMinutes: 60,
    graceMinutes: 360,
  },
  "channel:email-outbound": {
    what:
      "No outbound email has been accepted by Resend across the entire platform. " +
      "Notification and billing mail may be going nowhere.",
    everyMinutes: 60,
    graceMinutes: 360,
  },
} as const satisfies Record<string, LivenessExpectation>;

export type LivenessKey = keyof typeof LIVENESS_EXPECTATIONS;

/**
 * The cron schedules this product is allowed to have.
 *
 * `CRON_JOBS` is typed by this, so adding a trigger without declaring what its
 * absence means is a compile error rather than a silent hole. This is the
 * "make declaration mandatory at the point of definition" ask of #387, and the
 * reason it is a type rather than a test: a test can be deleted by whoever is
 * annoyed by it, a type cannot be ignored.
 */
export type CronSchedule =
  LivenessKey extends infer K
    ? K extends `cron:${infer Schedule}`
      ? Schedule
      : never
    : never;

/** Record that `key` just happened. Returns true when this ENDED an outage. */
export async function recordHeartbeat(
  env: Env,
  key: LivenessKey,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<boolean> {
  const { data, error } = await db.rpc("record_heartbeat", {
    p_key: key,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`record_heartbeat(${key}) failed: ${error.message}`);
  return (data as { recovered?: boolean } | null)?.recovered === true;
}

/**
 * Record a heartbeat WITHOUT letting a failure take down the caller.
 *
 * Used from `scheduled()`, where the heartbeat is bookkeeping wrapped around
 * the actual work: a liveness write that failed must never be the reason a
 * cron run is reported as broken. The write failing is itself an absence, and
 * the checker notices it one cadence later — which is the mechanism working,
 * not a hole in it.
 */
export async function recordHeartbeatBestEffort(
  env: Env,
  key: LivenessKey,
  now?: Date,
  db?: SupabaseClient,
): Promise<void> {
  try {
    await recordHeartbeat(env, key, now, db);
  } catch (cause) {
    console.error(`liveness: heartbeat ${key} failed to record: ${String(cause)}`);
  }
}
