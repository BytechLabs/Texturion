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
  // ---------------------------------------------------------------------
  // Per-JOB expectations (#333).
  //
  // A schedule firing is not the same as its jobs working. The 15-minute
  // trigger carries seven of them; if one threw on its first statement every
  // single run, the schedule still fired and the `cron:` heartbeat above
  // still beat. So each job records its own heartbeat, and ONLY ON SUCCESS —
  // which makes "this job has been broken every run since Tuesday" and "this
  // job has not run" the same alert, arriving on the same path.
  //
  // A transient failure that recovers on the next run never reaches its grace
  // window, so this adds no noise. Only the persistently-broken job speaks up.
  //
  // Cadence and grace mirror the schedule each job rides, because a job
  // cannot run more often than its trigger fires.
  // ---------------------------------------------------------------------
  "job:lead-chase": {
    what: "Unanswered new leads are no longer being chased — the five-minute first-response promise (#388) is unenforced.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "job:sweep-webhooks": {
    what: "Failed provider webhooks are not being replayed — the backstop for the entire inbound path has stopped backstopping.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:fail-stuck-sends": {
    what: "Sends that crashed before reaching Telnyx are not being failed out, so they never surface as retryable.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:sweep-stuck-provisioning": {
    what: "Numbers wedged in 'provisioning' are not being flipped to failed, so a paying customer sits on a hopeful status forever.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:liveness-check": {
    what: "The liveness checker itself has stopped completing — every other alert here is now unreliable.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:notify-due-tasks": {
    what: "Task due-date reminders are not going out.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-numbers": {
    what: "Provisioning is not being retried or reconciled — crash-after-buy orphans are unadopted and we pay Telnyx for numbers nobody holds.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:retry-campaign-assignments": {
    what: "Failed 10DLC campaign number-assignments are not being retried.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:sweep-deleted-attachments": {
    what: "Soft-deleted attachments are not being reclaimed, so storage bills grow for data nobody can reach.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-text-enablement": {
    what: "Hosted text-enablement orders are not being polled — a kept number never goes live.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-voice-enablement": {
    what: "Voice is not being bound to active numbers, so missed-call text-back silently never fires.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:report-usage": {
    what: "Metered message usage is not reaching Stripe — we deliver the service and do not bill for it.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:report-voice-usage": {
    what: "Metered voice minutes are not reaching Stripe — same revenue leak as the segment reporter.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:usage-alerts": {
    what: "The 80%/100% usage alerts have stopped, so a customer's first warning is their overage.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:overage-warning": {
    what: "The projected-cost warning has stopped — a tenant costing more than they pay goes unnoticed.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:inbound-canary": {
    what:
      "The synthetic inbound canary job has stopped running, so nothing is " +
      "generating the traffic that proves the inbound path works.",
    // Unconditional, unlike `channel:inbound-canary` above: this key means
    // "the job ran", which is true and worth knowing whether or not the number
    // pair is configured — an unconfigured canary still returns cleanly, and a
    // job that stopped executing is a different fault from one that is off.
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:email-health": {
    what:
      "The email bounce/complaint rate check has stopped. The domain reputation " +
      "cliff is one-way, so nobody would learn we were approaching it (#386).",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:sweep-stale-calls": {
    what: "Calls wedged in-flight are not being closed, so /calls lies and the per-conversation dial guard stays shut.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:nudge-sole-prop-otp": {
    what: "Sole-proprietor OTP nudges have stopped, so a stalled registration is never chased.",
    everyMinutes: 60,
    graceMinutes: 90,
  },
  "job:geocode-contacts": {
    what: "Contact geocoding has stopped and the map stops gaining pins.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "job:geocode-tasks": {
    what: "Task geocoding has stopped, so tasks pin at their contact's address rather than their own.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "job:poll-registrations": {
    what: "10DLC/A2P registration transitions are not being polled — an approved customer is never let out of the waiting room.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:delivery-by-country": {
    what: "The delivery-rate-by-country split has stopped, which is the only signal that would show a carrier silently filtering us (#379, #235).",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:poll-port-requests": {
    what: "In-flight number ports are unattended — a stalled saga never resumes.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:grace-and-release": {
    what: "Grace warnings and releases have stopped: a customer loses their number with no warning, or we keep paying for numbers past cancellation.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:subscription-reconcile": {
    what: "Missed Stripe webhooks are not being corrected and billing state drifts from reality.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:opt-out-reconcile": {
    what: "We are no longer comparing our opt-out list to the carrier's — a missed STOP leaves the composer open and every send failing (#331).",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:overage-digest": {
    what: "The weekly founder cost digest has stopped.",
    everyMinutes: 10080,
    graceMinutes: 1440,
  },
  "job:prune-webhook-events": {
    what: "The webhook ledger is no longer pruned and grows without bound.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-audit-log": {
    what: "The audit log is no longer pruned past its 12-month window.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:purge-closed-workspaces": {
    what: "Closed workspaces are not being purged — data we promised to delete is still here.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-user-sessions": {
    what: "Ended and revoked device rows (#236) are no longer pruned past their 90-day window.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-expired-exports": {
    what:
      "Expired data exports are not being deleted from storage. Each one is a full " +
      "copy of a workspace's messages and contacts, kept past its own seven-day promise (#378).",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:build-data-exports": {
    what: "Requested data exports are never built, so a customer's export request silently never completes.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  // ---------------------------------------------------------------------
  // WORK expectations (#333 ask 3): "report work done, not just execution".
  //
  // A job can run every hour, succeed every hour, and still be failing at the
  // thing it exists for. The re-reporters are the case that matters, because
  // what leaks is revenue: rows sit unreported, every Stripe call errors, the
  // job catches and continues, and both the schedule and the job heartbeat
  // look perfect.
  //
  // The signal is a conjunction, not a count: healthy means EITHER there was
  // nothing outstanding OR we reported something. Outstanding work plus zero
  // reported is the only shape that is wrong — and it is the only one that
  // does not false-alarm on a quiet platform with no traffic to report.
  // ---------------------------------------------------------------------
  "job:report-usage:work": {
    what:
      "Message usage has been sitting unreported for hours and every attempt to " +
      "send it to Stripe failed. We are delivering the service and not billing for it.",
    everyMinutes: 60,
    graceMinutes: 180,
  },
  "job:report-voice-usage:work": {
    what:
      "Voice minutes have been sitting unreported for hours and every attempt to " +
      "send them to Stripe failed. Same revenue leak as the segment reporter.",
    everyMinutes: 60,
    graceMinutes: 180,
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
  // ---------------------------------------------------------------------
  // INBOUND webhook classes (#308).
  //
  // Everything inbound arrives by webhook. If they stop, nothing throws —
  // there is only an absence, and an absence reads as a quiet Tuesday. It is
  // the most dangerous failure shape this product has: silent AND total, with
  // the first signal being an angry phone call hours later.
  //
  // THREE KEYS, NOT ONE, because the paths fail independently. Message
  // webhooks fine and call webhooks dead is a real shape and nobody would spot
  // it until somebody missed a call.
  //
  // WHY THE GRACES ARE WIDE, AND WHY THAT IS HONEST. #308 asks for a
  // per-time-of-day baseline so a fixed threshold does not page at 3am every
  // night and get muted within a week. The premise is right and the remedy is
  // not: a baseline needs volume to be a baseline, and at this platform's size
  // a genuinely quiet overnight hour is indistinguishable from a total outage
  // no matter how the threshold is computed. Inferring from customer traffic
  // cannot be made fast AND quiet at once, so these are deliberately the slow,
  // quiet backstop — and the synthetic canary is what makes detection fast,
  // because it generates the traffic instead of waiting for it.
  //
  // A false alarm costs more than the delay it saves: it is exactly how a
  // founder learns to ignore this mailbox, and then every other key here goes
  // with it.
  "channel:telnyx-inbound-message": {
    what:
      "No inbound text has arrived from Telnyx across the entire platform. " +
      "Either nobody has texted any customer, or every business number in the " +
      "product is silently swallowing messages.",
    everyMinutes: 60,
    graceMinutes: 720,
  },
  "channel:telnyx-message-status": {
    what:
      "No message-status webhook has arrived from Telnyx. Sends may be leaving " +
      "and never being confirmed, so every message sits on 'sent' forever and " +
      "a genuine delivery failure is indistinguishable from success.",
    everyMinutes: 60,
    graceMinutes: 720,
  },
  "channel:telnyx-call-events": {
    what:
      "No call event has arrived from Telnyx. Inbound calls would ring nowhere " +
      "and no voicemail would ever be recorded.",
    // The widest grace here, because call volume is the lowest: a whole day
    // with no calls is an ordinary day for a small crew, so this key can only
    // ever be a slow backstop. A synthetic call is what would make it sharp.
    everyMinutes: 1440,
    graceMinutes: 2880,
  },
  // ---------------------------------------------------------------------
  // The signature-rejection conjunction (#308) — the sharp instrument, and
  // the only one here that is independent of traffic volume.
  //
  // A rejection is a `return`, not a throw, so Sentry never sees it. Nonzero
  // rejections ALONE are ordinary noise (a retry, a stale delivery, a probe).
  // Rejections with ZERO accepted webhooks in the same window is the rotated-
  // secret shape and nothing else looks like it: the provider believes it is
  // delivering, we believe nothing is arriving, and both are wrong.
  //
  // Expressed as a heartbeat recorded while HEALTHY — the same conjunction the
  // `:work` keys above use, for the same reason: it is the only formulation
  // that does not false-alarm on a platform with no traffic to reject.
  // ---------------------------------------------------------------------
  // The canary (#308) — the fast, unambiguous half.
  //
  // The traffic keys above are wide because customer traffic cannot tell
  // "broken" from "quiet" at this volume. This one generates the traffic, so
  // its silence means something specific and it can afford a tight grace.
  //
  // CONDITIONALLY DECLARED. `runLivenessCheckJob` omits this expectation when
  // the canary is unconfigured — an expectation for something nobody asked
  // for would alert forever about a feature that was never switched on, and
  // that is precisely how this mailbox stops being read.
  "channel:inbound-canary": {
    what:
      "The synthetic inbound canary has not completed a round trip. A text we " +
      "sent from our own number to our own number did not come back as a " +
      "webhook, so the inbound path is broken somewhere between Telnyx and " +
      "our handler — this one is not a quiet hour, because we generated the " +
      "traffic ourselves.",
    everyMinutes: 60,
    graceMinutes: 150,
  },
  "channel:webhook-signature": {
    what:
      "Signed provider webhooks are being REJECTED and none are being accepted — " +
      "the signing secret has almost certainly rotated. Every delivery is " +
      "arriving and being discarded, which is invisible on both sides: the " +
      "provider believes it is delivering and nothing here throws.",
    everyMinutes: 60,
    graceMinutes: 120,
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
/**
 * The liveness key of a single scheduled job (#333).
 *
 * `CRON_JOBS` entries are `{ key, run }` pairs typed by this, so a job cannot
 * be added to a schedule without declaring what its silence means — the same
 * compile-time move that already governs the schedules themselves.
 */
export type JobKey = Extract<LivenessKey, `job:${string}`>;

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
