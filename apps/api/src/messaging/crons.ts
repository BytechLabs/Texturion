/**
 * Messaging-track scheduled jobs (SPEC §11). All are idempotent and safe to
 * re-run: work items are selected by state, never by "last run" bookkeeping.
 *
 *   sweepWebhookEvents  (*\/5)  — replay `webhook_events` rows still
 *     unprocessed after 2 minutes (waitUntil died, transient failure), up to
 *     5 attempts; the 5th failure is reported as an exception. Telnyx rows replay
 *     through the same dispatch as the live route; Stripe rows through the
 *     billing track's processStripeEvent — durability without Queues (D11).
 *     #22: each row is CLAIMED (atomic CAS on attempts + a claimed_at lease)
 *     before dispatch, so overlapping cron runs never double-process a row —
 *     several downstream handlers are check-then-act (a replayed 10DLC
 *     brand-approved event would otherwise register a SECOND campaign with a
 *     recurring carrier fee). A crashed claimer's lease expires and the row
 *     is retried while attempts remain.
 *
 *   pruneWebhookEvents  (daily)  — retention for that same ledger: drop
 *     PROCESSED rows past the 30-day dedupe window, oldest-first and batched.
 *     The sweeper only ever replays; without this the ledger (full payload per
 *     webhook) grows without bound, linearly with messages + calls.
 *
 *   failStuckOutboundSends  (*\/5)  — #20: fail out outbound rows stuck
 *     'queued' with no telnyx_message_id beyond the safety window (the send
 *     crashed between the gate insert and the Telnyx call), so they surface
 *     in the thread as retryable failures and stop consuming the usage cap.
 *
 *   reportUnreportedUsage  (hourly)  — re-POST Stripe meter events for
 *     usage_events where stripe_reported_at IS NULL (the local stamp is the
 *     gate; Stripe's identifier dedupe is the ≥24h safeguard, §9). #53: a
 *     duplicate-identifier rejection means Stripe ALREADY accepted this
 *     event on an attempt whose stamp never landed — treated as success
 *     (stamp and move on), never as a retryable failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { METER_TIMEOUT_MS, reportSegmentUsage, reportVoiceSeconds } from "../billing/meter";
import { getDb } from "../db";
import type { Env } from "../env";
import { captureException, scrubbedError } from "../observability/capture";
import { isDefiniteRefusal, telnyxRequest } from "../telnyx/client";
import { processResendEvent } from "../webhooks/resend";
import { processStripeEvent } from "../webhooks/stripe";
import { dispatchTelnyxEvent } from "./dispatch";
import { STUCK_SEND_SECONDS } from "./send";

const SWEEP_MIN_AGE_MS = 2 * 60 * 1000;
const SWEEP_MAX_ATTEMPTS = 5;
const SWEEP_BATCH = 100;
const REPORT_BATCH = 200;
const REPORT_BUDGET_MS = 60_000;
const HOUR_MS = 3_600_000;
const METER_REPORT_COLUMNS =
  "id,company_id,created_at,report_attempts,companies!inner(stripe_customer_id)";
/**
 * Retention for the `webhook_events` ledger. The ledger's one guarantee is
 * deduping a provider RE-delivery, so retention only has to outlast the
 * longest redelivery either provider can produce: Stripe retries for ~3 days
 * (an event stays manually re-sendable for 30), Telnyx gives up far sooner.
 * 30 days keeps the dedupe window strictly wider than both.
 */
const WEBHOOK_RETENTION_DAYS = 30;

/**
 * #581: the widget proof-of-number window, matching the SQL default.
 *
 * Stated here as well as there because the caller decides the policy and the
 * function only enforces whatever it is handed — a default in SQL that nobody
 * passes is a number with no owner.
 */
const WIDGET_VERIFICATION_RETENTION_DAYS = 30;
/**
 * Per-run ceiling. Comfortably above the ingest rate at any plausible volume,
 * so a backlog drains over consecutive days instead of one cron run holding a
 * long delete.
 */
const PRUNE_BATCH = 5000;
/**
 * #22: how long a claim shields a row from other sweep runs. Longer than any
 * realistic sweep pass (even 100 rows × media downloads), shorter than
 * forever so a crashed claimer's row is retried within two cadences.
 */
const SWEEP_CLAIM_LEASE_MS = 10 * 60 * 1000;

interface WebhookEventRow {
  provider: "telnyx" | "stripe" | "resend";
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** §11 webhook sweeper: reprocess the unprocessed ledger tail. */
export async function sweepWebhookEvents(env: Env): Promise<void> {
  const db = getDb(env);
  const now = Date.now();
  const cutoff = new Date(now - SWEEP_MIN_AGE_MS).toISOString();
  const leaseCutoff = new Date(now - SWEEP_CLAIM_LEASE_MS).toISOString();
  const unclaimedFilter = `claimed_at.is.null,claimed_at.lt.${leaseCutoff}`;

  const { data, error } = await db
    .from("webhook_events")
    .select("provider,event_id,event_type,payload,attempts")
    .is("processed_at", null)
    .lt("received_at", cutoff)
    .lt("attempts", SWEEP_MAX_ATTEMPTS)
    .or(unclaimedFilter)
    .order("received_at", { ascending: true })
    .limit(SWEEP_BATCH);
  if (error) throw new Error(`webhook_events sweep query failed: ${error.message}`);

  for (const row of (data ?? []) as WebhookEventRow[]) {
    // #22: claim the row before dispatching — an atomic CAS UPDATE (attempts
    // is the token: any concurrent claimer bumped it, so the .eq() matches
    // for exactly ONE caller) that also stamps the claimed_at lease. Losing
    // the claim, or failing to issue it, skips the row — it stays in the
    // ledger for whichever run owns it (fail closed, never double-process).
    const attempts = row.attempts + 1;
    const { data: claimed, error: claimError } = await db
      .from("webhook_events")
      .update({ attempts, claimed_at: new Date().toISOString() })
      .eq("provider", row.provider)
      .eq("event_id", row.event_id)
      .eq("attempts", row.attempts)
      .is("processed_at", null)
      .or(unclaimedFilter)
      .select("event_id");
    if (claimError) {
      console.error(
        `sweep claim failed for ${row.provider} ${row.event_id}:`,
        claimError.message,
      );
      continue;
    }
    if ((claimed ?? []).length === 0) continue; // another run owns this row

    try {
      // #386: an explicit branch per provider, and a throw on an unknown one.
      // This was `if telnyx … else stripe`, which meant the moment a third
      // provider joined the ledger its rows were silently handed to Stripe's
      // processor — replayed forever against a handler that could never
      // understand them.
      switch (row.provider) {
        case "telnyx": {
          await dispatchTelnyxEvent(env, row.payload);
          break;
        }
        case "resend": {
          await processResendEvent(
            env,
            row.payload as unknown as Parameters<typeof processResendEvent>[1],
          );
          break;
        }
        case "stripe": {
          await processStripeEvent(
            env,
            row.payload as unknown as Parameters<typeof processStripeEvent>[1],
          );
          break;
        }
        default: {
          throw new Error(
            `sweep: no handler for webhook provider "${row.provider}"`,
          );
        }
      }
      const { error: stampError } = await db
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("provider", row.provider)
        .eq("event_id", row.event_id);
      if (stampError) {
        throw new Error(`sweep stamp failed: ${stampError.message}`);
      }
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : String(error_);
      // The claim already counted this attempt — record the error only.
      console.error(
        `sweep of ${row.provider} ${row.event_id} (${row.event_type}) failed (attempt ${attempts}):`,
        message,
      );
      await db
        .from("webhook_events")
        .update({ last_error: message.slice(0, 2000) })
        .eq("provider", row.provider)
        .eq("event_id", row.event_id);
      if (attempts >= SWEEP_MAX_ATTEMPTS) {
        // §11: reported at attempt 5, ids only, never payload bodies (§10).
        void captureException(env, `webhook replay failed ${SWEEP_MAX_ATTEMPTS} times`, {
          source: "cron",
          job: "job:sweep-webhooks",
          extra: {
            provider: row.provider,
            event_id: row.event_id,
            event_type: row.event_type,
            attempts,
          },
        });
      }
    }
  }
}

/**
 * Ledger retention: drop PROCESSED `webhook_events` past the dedupe window.
 *
 * The sweeper above only ever replays the unprocessed tail — nothing removed a
 * row, so the ledger (which stores each webhook's full payload) grew without
 * bound for the life of the install, linearly with messages + calls. This caps
 * it. Only processed rows are eligible: an unprocessed row is still owed a
 * replay, and one that exhausted its attempts is the forensic record behind a
 * §11 exception.
 */

/**
 * #581 — the widget's proof-of-number records, past their window.
 *
 * ## Why this exists now and not when the table did
 *
 * `api_prune_widget_verifications` was written with the table, granted to
 * service_role, and documented as "so a cron can report what it did rather
 * than claim it ran". No cron ever called it. A function nobody invokes is
 * indistinguishable from one that was never written, except that it reads as
 * a control when somebody audits the schema.
 *
 * ## Why it matters more than an ordinary retention job
 *
 * Every other prune here trims OUR customers' data. This one holds rows about
 * STRANGERS — a phone number and an IP belonging to somebody who typed into a
 * form on a plumber's website and never became a contact, never consented to
 * anything, and has no account through which to ask us to forget them.
 * Keeping that indefinitely is the kind of thing a data-protection
 * questionnaire asks about by name.
 *
 * The window is the function's own default: 30 days, long enough for the
 * abuse forensics the table exists for.
 */
export async function pruneWidgetVerifications(env: Env): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db.rpc("api_prune_widget_verifications", {
    p_days: WIDGET_VERIFICATION_RETENTION_DAYS,
  });
  if (error) {
    throw new Error(`widget_verifications prune failed: ${error.message}`);
  }
  const removed = typeof data === "number" ? data : 0;
  if (removed > 0) {
    console.log(`widget_verifications prune removed ${removed} row(s)`);
  }
}

export async function pruneWebhookEvents(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const before = new Date(
    now.getTime() - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db.rpc("api_prune_webhook_events", {
    p_before: before,
    p_limit: PRUNE_BATCH,
  });
  if (error) {
    throw new Error(`webhook_events prune failed: ${error.message}`);
  }
  const removed = typeof data === "number" ? data : 0;
  if (removed >= PRUNE_BATCH) {
    // Hit the ceiling: a backlog is still draining. Visible so a ledger growing
    // faster than one run can trim never stays silent.
    console.log(
      `webhook_events prune removed ${removed} rows (batch ceiling — more remain)`,
    );
  }
}

/**
 * #20 stuck-send sweeper: fail out outbound rows still 'queued' with no
 * telnyx_message_id beyond the safety window — the send crashed between the
 * gate insert and the Telnyx call, so the row would otherwise sit queued
 * forever (silently unsent, unretryable, and counting against the period
 * cap's pending sum). Flipping to failed + `send_interrupted` surfaces it in
 * the thread with the existing retry affordance. Piggybacks the 5-minute
 * webhook-sweep cadence; a flip is worth reporting (a customer's message was
 * silently NOT sent) — count only, never bodies (§10).
 */
export async function failStuckOutboundSends(env: Env): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db.rpc("fail_stuck_outbound_sends", {
    p_stuck_after_seconds: STUCK_SEND_SECONDS,
  });
  if (error) {
    throw new Error(`fail_stuck_outbound_sends failed: ${error.message}`);
  }
  const count = Number(data ?? 0);
  if (count > 0) {
    console.error(`failed out ${count} stuck queued outbound message(s)`);
    void captureException(env, "stuck-send sweeper failed out queued outbound messages", {
      source: "cron",
      job: "job:fail-stuck-sends",
      level: "warning",
      extra: { count },
    });
  }
}

interface UnreportedMeterRow {
  id: string;
  company_id: string;
  quantity: number;
  meter_identifier: string | null;
  created_at: string;
  report_attempts: number;
  companies: { stripe_customer_id: string } | null;
}

/**
 * #53: does this meter-event failure mean Stripe ALREADY accepted the
 * identifier (an earlier report whose local stamp never landed)? Stripe
 * rejects a reused meter-event identifier with an invalid_request_error
 * whose message names the identifier as already existing; stripe-node
 * surfaces it as a StripeInvalidRequestError. There is no dedicated error
 * code for it, so this matches the error class plus the message shape —
 * anything else stays a retryable failure (fail closed: never stamp on an
 * ambiguous error).
 */
export function isDuplicateMeterIdentifierError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const { type, rawType, message } = cause as {
    type?: unknown;
    rawType?: unknown;
    message?: unknown;
  };
  return (
    (type === "StripeInvalidRequestError" ||
      rawType === "invalid_request_error") &&
    typeof message === "string" &&
    /identifier/i.test(message) &&
    /(already|duplicate)/i.test(message)
  );
}

async function retryMeterRows(
  env: Env,
  db: SupabaseClient,
  meter: "segments" | "voice",
  rows: UnreportedMeterRow[],
  deadline: number,
): Promise<void> {
  const table = meter === "segments" ? "usage_events" : "call_records";
  const report = meter === "segments" ? reportSegmentUsage : reportVoiceSeconds;
  let failed = 0;
  let lastFailure: unknown;

  for (const row of rows) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const stripeCustomerId = row.companies?.stripe_customer_id;
    if (!stripeCustomerId) continue;

    let failure: { error: unknown } | undefined;
    try {
      await report(
        env,
        {
          stripeCustomerId,
          value: row.quantity,
          identifier: row.meter_identifier ?? row.id,
        },
        {
          timestamp: Math.floor(Date.parse(row.created_at) / 1000),
          timeout: Math.min(METER_TIMEOUT_MS, remaining),
        },
      );
    } catch (error) {
      if (!isDuplicateMeterIdentifierError(error)) {
        failure = { error };
      }
    }

    if (failure) {
      failed += 1;
      lastFailure = failure.error;
      const delayHours = Math.min(24, 2 ** Math.min(row.report_attempts, 5));
      const { error: retryError } = await db
        .from(table)
        .update({
          report_attempts: row.report_attempts + 1,
          report_next_at: new Date(Date.now() + delayHours * HOUR_MS).toISOString(),
        })
        .eq("id", row.id)
        .eq("company_id", row.company_id)
        .eq("report_attempts", row.report_attempts)
        .is("stripe_reported_at", null);
      if (retryError) {
        throw new Error(`${table} meter retry scheduling failed: ${retryError.message}`, {
          cause: scrubbedError(failure.error),
        });
      }
      continue;
    }

    const { error } = await db
      .from(table)
      .update({ stripe_reported_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("company_id", row.company_id)
      .is("stripe_reported_at", null);
    if (error) throw new Error(`${table} meter stamp failed: ${error.message}`);
  }

  if (failed > 0) {
    void captureException(env, lastFailure, {
      source: "cron",
      job: meter === "segments" ? "job:report-usage" : "job:report-voice-usage",
      extra: { found: rows.length, failed },
    });
  }
}

/** ?11 usage re-reporter: meter events for locally unstamped usage rows. */
export async function reportUnreportedUsage(env: Env): Promise<void> {
  const db = getDb(env);
  const now = Date.now();
  const { data, error } = await db
    .from("usage_events")
    .select(`quantity,meter_identifier,${METER_REPORT_COLUMNS}`)
    .is("stripe_reported_at", null)
    .not("companies.stripe_customer_id", "is", null)
    .gt("quantity", 0)
    .lte("report_next_at", new Date(now).toISOString())
    .order("report_next_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(REPORT_BATCH);
  if (error) throw new Error(`usage re-report query failed: ${error.message}`);

  await retryMeterRows(
    env,
    db,
    "segments",
    (data ?? []) as unknown as UnreportedMeterRow[],
    now + REPORT_BUDGET_MS,
  );
}

export async function reportUnreportedVoiceUsage(env: Env): Promise<void> {
  if (!env.STRIPE_VOICE_METER_EVENT_NAME) return;
  const db = getDb(env);
  const now = Date.now();

  // Clear non-billable rows written before the reporting stamp existed.
  const { error: sweepError } = await db
    .from("call_records")
    .update({ stripe_reported_at: new Date(now).toISOString() })
    .is("stripe_reported_at", null)
    .or(
      "and(leg.neq.forward,leg.neq.out_customer,leg.neq.in_browser),billable_seconds.eq.0",
    );
  if (sweepError) {
    throw new Error(`voice non-billable sweep failed: ${sweepError.message}`);
  }

  const { data, error } = await db
    .from("call_records")
    .select(`quantity:billable_seconds,meter_identifier:call_leg_id,${METER_REPORT_COLUMNS}`)
    .is("stripe_reported_at", null)
    .not("companies.stripe_customer_id", "is", null)
    .in("leg", ["forward", "out_customer", "in_browser"])
    .gt("billable_seconds", 0)
    .lte("report_next_at", new Date(now).toISOString())
    .order("report_next_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(REPORT_BATCH);
  if (error) throw new Error(`voice re-report query failed: ${error.message}`);

  await retryMeterRows(
    env,
    db,
    "voice",
    (data ?? []) as unknown as UnreportedMeterRow[],
    now + REPORT_BUDGET_MS,
  );
}

/**
 * #133: flip call sessions wedged in-flight (outcome NULL past a generous
 * window — lost terminal webhook, failed transfer with exhausted replays,
 * dial with no events) to 'missed', the conservative "never proved
 * connected" outcome for both directions. Keeps /calls honest (no eternal
 * "Calling…") and re-opens the per-conversation double-dial guard. Billing
 * is per-leg in call_records and unaffected. #209: rows whose DO state
 * mirror is ALREADY terminal ('ended_%') instead finalize FAST (minutes) and
 * derive the outcome FROM the mirror - the sweep never relabels a truthful
 * ended_answered as missed. The RPC owns both windows (4 hours conservative,
 * 5 minutes mirror-terminal) so the SQL tests pin them.
 */
export async function sweepStaleCalls(env: Env): Promise<void> {
  const db = getDb(env);

  // D43: garbage-collect outbound-call authorizations that were minted but
  // never consumed (the browser failed to dial). They're single-use and
  // age-checked at consume time, so a stale one is harmless — this just keeps
  // the table small.
  const { error: authSweepError } = await db
    .from("outbound_call_authorizations")
    .delete()
    .lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (authSweepError) {
    console.error(
      `outbound authorization sweep failed: ${authSweepError.message}`,
    );
  }

  // D43 cost backstop: a browser-answered call has NO Telnyx-side time limit
  // (unlike the legacy cell forward's time_limit_secs — a client-originated /
  // browser-answered leg can't carry one), so a member who leaves a call
  // connected (a PBX hold queue, a forgotten tab) could run it for hours. Hang
  // up the customer leg of any call open longer ago than the hard ceiling; its
  // terminal hangup then bills the talk time and finalizes the outcome
  // normally. This bounds a single call's cost even between period-cap checks.
  // #581: the ceiling is not browser-specific. It is the only bound on ANY open
  // customer leg whose terminal webhook is lost — including one WE answered,
  // into voicemail or the #490 notice — so neither arm below filters by
  // direction or by how the leg came to be answered.
  const ceiling = new Date(Date.now() - MAX_LIVE_CALL_MS).toISOString();

  // (a) The common case — a call whose ANSWER STAMP LANDED, open past the
  //     ceiling. answered_at is the billing anchor (a member picked up, or an
  //     outbound callee did), NOT "the carrier connected", so talk time is
  //     known and the ceiling is measured from it rather than from creation.
  const { data: runaway, error: runawayError } = await db
    .from("calls")
    .select("call_session_id,customer_call_control_id")
    .is("outcome", null)
    .not("answered_at", "is", null)
    .not("customer_call_control_id", "is", null)
    .lt("answered_at", ceiling)
    .limit(200);
  if (runawayError) {
    throw new Error(`runaway calls read failed: ${runawayError.message}`);
  }

  // (b) Every OTHER open leg, aged by CREATION instead. Two ways a connected,
  //     carrier-billing call reaches the ceiling with no answer stamp, and (a)
  //     excludes both:
  //       - #145 OUTBOUND: call.answered can race ahead of call.initiated and
  //         leave answered_at null on a genuinely-connected call — the exact
  //         out-of-order race the surrounding code already treats as possible.
  //       - #581 INBOUND: WE answered the customer leg to play voicemail
  //         (telnyx-answer-vm) or the #490 suspended-line notice
  //         (telnyx-answer-notice). Neither stamps answered_at — correctly, it
  //         is the member-answer billing anchor, not a carrier-connect flag —
  //         so Telnyx bills a live answered leg the sweep could not see.
  //     Hence no direction filter: past a full ceiling with no answer stamp, an
  //     open leg is runaway whichever way it was dialed. It cannot overlap (a)
  //     — answered_at nullity partitions the two sets, so no row is ever hung
  //     up twice (the ccid Map below is the second guard).
  //
  //     This is the LAST chance to stop the money, not merely a slower one:
  //     api_sweep_stale_calls at the tail flips a wedged row's outcome to
  //     'missed' (4h, or 5 minutes once the DO mirror reads ended_%), and BOTH
  //     queries here require outcome IS NULL. After that flip the row is
  //     honest, the leg is still up, and nothing on this path can reach it.
  const { data: unstamped, error: unstampedError } = await db
    .from("calls")
    .select("call_session_id,customer_call_control_id")
    .is("outcome", null)
    .is("answered_at", null)
    .not("customer_call_control_id", "is", null)
    .lt("created_at", ceiling)
    .limit(200);
  if (unstampedError) {
    throw new Error(`unstamped runaway calls read failed: ${unstampedError.message}`);
  }

  // One hangup per distinct customer leg across both sets — which the
  // answered_at partition already guarantees per ROW, so this is the guard for
  // two rows naming one leg.
  const runawayByCcid = new Map<string, string>();
  for (const row of [...(runaway ?? []), ...(unstamped ?? [])]) {
    runawayByCcid.set(
      row.customer_call_control_id as string,
      row.call_session_id as string,
    );
  }
  for (const [ccid, sessionId] of runawayByCcid) {
    try {
      await telnyxRequest(env, {
        method: "POST",
        path: `/v2/calls/${ccid}/actions/hangup`,
        body: {},
      });
      console.warn(`runaway call hung up: session ${sessionId}`);
    } catch (error_) {
      // Dead leg / already gone (4xx) is the normal case — the stale-outcome
      // RPC below finalizes its row.
      if (isDefiniteRefusal(error_)) continue;
      console.error(
        `runaway call hangup failed for ${ccid}:`,
        error_ instanceof Error ? error_.message : String(error_),
      );
    }
  }

  const { data, error } = await db.rpc("api_sweep_stale_calls", {
    p_stale_before: null,
    p_terminal_stale_before: null,
  });
  if (error) {
    throw new Error(`stale calls sweep failed: ${error.message}`);
  }
  const swept = (data as number | null) ?? 0;
  if (swept > 0) {
    console.warn(`stale calls sweep: ${swept} session(s) finalized`);
  }
}

/** D43: hard ceiling on a single live call's duration (2h) — the cost
 *  backstop for browser legs that carry no Telnyx-side time limit. */
const MAX_LIVE_CALL_MS = 2 * 60 * 60 * 1000;
