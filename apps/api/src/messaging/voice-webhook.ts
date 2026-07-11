/**
 * Inbound-call Call-Control handler (FEATURE-GAPS voice wave, Step 1c),
 * dispatched from /webhooks/telnyx on `call.*` event types (same verified,
 * ledgered, ack-then-waitUntil path the messaging webhooks use).
 *
 * Flow for an INBOUND call to a per-company number:
 *
 *   call.initiated (direction=incoming)
 *     → resolve the receiving number → (company, phone_number).
 *     → load the company's forward_to_cell.
 *         - forward_to_cell SET  → ANSWER the inbound leg (POST
 *           /v2/calls/:id/actions/answer) and DIAL the cell as a second leg
 *           with timeout_secs + AMD (client_state='mctb_forward' so the
 *           forward leg's events are identifiable), then WAIT for its
 *           terminal signal.
 *         - forward_to_cell NULL → do NOT answer. There is no one to connect
 *           the caller to, so answering would put them into dead air (and
 *           bill the leg). The call rings out naturally — the caller hears
 *           exactly "nobody picked up" — and the inbound leg's later
 *           call.hangup is the missed signal.
 *
 *   call.machine.detection.ended (forward leg) → AMD verdict:
 *     'human' → answered, stop. 'machine'/'not_human' → MISSED → text-back.
 *
 *   call.hangup → compute missed per {@link computeMissedFromEvent}; on missed
 *     fire the text-back + crew alert via {@link sendMissedCallText}.
 *
 * "Missed" is COMPUTED from the dial timeout + AMD result (no human answered in
 * time) — never a bare hangup on an answered call. Idempotency is per
 * call_session_id at the claim RPC, so a retried webhook never double-texts.
 *
 * client_state tagging (per the Telnyx transfer contract — the two params tag
 * DIFFERENT legs): `client_state` attaches to the leg the command is issued ON
 * (the inbound leg), `target_leg_client_state` to the NEW dialed leg. We stamp
 * BOTH on the transfer: 'mctb_inbound_fwd' on the inbound leg and
 * 'mctb_forward|<caller>' on the forward leg. Terminal events then classify
 * their leg from the echoed tag alone — 'mctb_forward' = the forward leg
 * (decides missed/answered), 'mctb_inbound_fwd' = the inbound leg of a
 * forwarded call (never decides), NO tag = the inbound leg of a NO-FORWARD
 * call (we issued no commands on it; its hangup IS the miss). Deciding from
 * the tag — the state at call time — also means a mid-call settings change to
 * forward_to_cell can never flip how the in-flight call is computed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { reportVoiceSeconds } from "../billing/meter";
import {
  GRANDFATHERED_VOICE_MINUTES,
  PLAN_VOICE_MINUTES,
  type PlanId,
} from "../billing/plans";
import { getDb } from "../db";
import type { Env } from "../env";
import { telnyxRequest } from "../telnyx/client";
import { computeMissedFromEvent } from "./missed-call";
import { sendMissedCallText } from "./missed-call";
import type { TelnyxEvent } from "./types";

/** The client_state tag we stamp on the forward (dial) leg. */
export const FORWARD_LEG_STATE = "mctb_forward";

/** The client_state tag we stamp on the INBOUND leg when we forward it. */
export const INBOUND_FORWARDED_STATE = "mctb_inbound_fwd";

/** Telnyx dial ring window before we declare the forward unanswered. */
export const FORWARD_TIMEOUT_SECS = 20;

/**
 * #12 hard ceiling on a SINGLE forwarded call's billable duration. The
 * period voice cap (companyOverVoiceCap) is a pre-answer boundary check, so
 * a call that answers just under the cap could otherwise run unbounded and blow
 * past the spending cap on its own. Telnyx auto-ends the leg at this limit,
 * bounding any one call's cost. 1h is far above a real business call.
 */
export const MAX_FORWARDED_CALL_SECS = 60 * 60;

/**
 * D36: the un-defeatable ceiling a NULL/garbage overage_cap_multiplier
 * resolves to — mirrors the DB CHECK (0,10] and the owner PATCH's null→10
 * coercion (20260704110000_hard_overage_ceiling.sql), so the voice gate can
 * never read "no cap".
 */
const MAX_CAP_MULTIPLIER = 10;

interface CallPayload {
  call_control_id?: string;
  call_session_id?: string;
  call_leg_id?: string;
  direction?: string; // 'incoming' | 'outgoing'
  from?: string;
  to?: string;
  state?: string;
  client_state?: string | null; // base64 of whatever we set
  hangup_cause?: string;
  result?: string; // AMD result on machine.detection.ended
  start_time?: string; // ISO — leg answered/started (call.hangup)
  end_time?: string; // ISO — leg ended (call.hangup)
}

/** Cause we reject an over-spending-cap inbound call with (D36 cap). */
const OVER_BUDGET_REJECT_CAUSE = "USER_BUSY";

interface CompanyVoiceState {
  plan: PlanId | null;
  current_period_start: string | null;
  overage_cap_multiplier: number | string | null;
}

/**
 * D36 (#128) voice spending cap: has the company's forwarded (dialed-leg)
 * time this period reached allowance × overage_cap_multiplier? Between the
 * fair-use allowance and this cap, extra minutes BILL at 1¢/min (the voice
 * meter) — forwarding only pauses here, the same boundary where text sending
 * pauses. A GRANDFATHERED voice module (free, no Stripe items — nothing can
 * bill its overage) keeps the pre-D36 deal: pause at the legacy 300-minute
 * allowance (review fix — otherwise every grandfathered tenant silently
 * gained a 25×-plus unbilled cost ceiling). Pre-checkout (no plan) or no
 * live period → not over (no allowance to exceed, and no numbers to receive
 * calls anyway).
 */
async function companyOverVoiceCap(
  db: SupabaseClient,
  companyId: string,
  company: CompanyVoiceState,
): Promise<boolean> {
  if (!company.plan || !company.current_period_start) return false;
  const { data, error } = await db.rpc("api_period_forward_seconds", {
    p_company_id: companyId,
    p_since: company.current_period_start,
  });
  if (error) {
    throw new Error(`voice usage lookup failed: ${error.message}`);
  }
  const usedSeconds = Number(data);

  const { data: moduleRows, error: moduleError } = await db
    .from("company_modules")
    .select("grandfathered")
    .eq("company_id", companyId)
    .eq("module", "voice")
    .is("disabled_at", null)
    .limit(1);
  if (moduleError) {
    throw new Error(`voice module lookup failed: ${moduleError.message}`);
  }
  if (moduleRows?.[0]?.grandfathered === true) {
    return usedSeconds >= GRANDFATHERED_VOICE_MINUTES * 60;
  }

  // Postgres numeric arrives as a string; the column is NOT NULL with CHECK
  // (0,10] since 20260704110000, but fail toward the hard 10× ceiling anyway.
  const multiplier = Number(company.overage_cap_multiplier);
  const capMultiplier =
    Number.isFinite(multiplier) && multiplier > 0
      ? Math.min(multiplier, MAX_CAP_MULTIPLIER)
      : MAX_CAP_MULTIPLIER;
  const capSeconds = PLAN_VOICE_MINUTES[company.plan] * 60 * capMultiplier;
  return usedSeconds >= capSeconds;
}

function decodeClientState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return atob(raw);
  } catch {
    return null;
  }
}

function encodeClientState(value: string): string {
  return btoa(value);
}

/**
 * The client_state we stamp on the forward (dial) leg encodes both the tag AND
 * the original inbound caller as `mctb_forward|<caller_e164>`, so the forward
 * leg's terminal events (which do not carry the inbound caller) recover it with
 * no DB round-trip. Build + parse are kept together so they never drift.
 */
function buildForwardState(callerE164: string): string {
  return encodeClientState(`${FORWARD_LEG_STATE}|${callerE164}`);
}

/** Which leg an event belongs to, from its echoed client_state tag alone. */
export type CallLeg = "forward" | "inbound_forwarded" | "inbound_untagged";

function classifyLeg(payload: CallPayload): CallLeg {
  const decoded = decodeClientState(payload.client_state);
  const tag = decoded?.split("|")[0];
  if (tag === FORWARD_LEG_STATE) return "forward";
  if (tag === INBOUND_FORWARDED_STATE) return "inbound_forwarded";
  return "inbound_untagged";
}

/** True when this event belongs to the forward (dial) leg we placed. */
function isForwardLeg(payload: CallPayload): boolean {
  return classifyLeg(payload) === "forward";
}

interface McTbCompany {
  id: string;
  forward_to_cell: string | null;
  plan: PlanId | null;
  current_period_start: string | null;
  overage_cap_multiplier: number | string | null;
  subscription_status: string;
}

/** Call-Control entry point (dispatched from /webhooks/telnyx). */
export async function handleCallEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<void> {
  const eventType = event.data?.event_type;
  if (typeof eventType !== "string") return;
  const payload = event.data?.payload as CallPayload | undefined;
  if (!payload) return;

  const db = getDb(env);

  if (eventType === "call.initiated") {
    return handleInboundInitiated(env, db, payload);
  }
  if (
    eventType === "call.hangup" ||
    eventType === "call.machine.detection.ended"
  ) {
    return handleTerminalCallEvent(env, db, eventType, payload);
  }
  // call.answered and other lifecycle events are acked no-ops.
}

/**
 * Resolve the company + number a call is FOR, from the dialed number (the
 * inbound leg's `to`; the forward leg's `to` is the cell, so this only applies
 * to the inbound leg). Returns null for a number we do not own.
 */
async function resolveNumber(
  db: SupabaseClient,
  toE164: string,
): Promise<{
  companyId: string;
  phoneNumberId: string;
  status: string;
} | null> {
  const { data, error } = await db
    .from("phone_numbers")
    .select("id,company_id,status")
    .eq("number_e164", toE164)
    .neq("status", "released")
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as
    | { id: string; company_id: string; status: string }
    | undefined;
  return row
    ? { companyId: row.company_id, phoneNumberId: row.id, status: row.status }
    : null;
}

/**
 * On inbound `call.initiated`: when a forward cell is configured, answer the
 * inbound leg and DIAL the cell (with timeout + AMD). With NO forward there is
 * no one to connect the caller to, so the call is left UNANSWERED — it rings
 * out naturally (answering would put the caller into dead air and bill the
 * leg) and the caller's hangup is the missed signal. Only INCOMING calls are
 * handled; the forward (outgoing) leg's own `call.initiated` (which Telnyx
 * also emits) is ignored via its direction + client_state.
 */
async function handleInboundInitiated(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
): Promise<void> {
  // The forward leg we placed is 'outgoing' and tagged — never re-forward it.
  if (payload.direction !== "incoming" || isForwardLeg(payload)) return;

  const callControlId = payload.call_control_id;
  const toE164 = payload.to;
  if (!callControlId || !toE164) return;

  const resolved = await resolveNumber(db, toE164);
  if (!resolved) return; // a number we do not own → no-op

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select(
      "id,forward_to_cell,plan,current_period_start,overage_cap_multiplier,subscription_status",
    )
    .eq("id", resolved.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }
  const company = (companyRows ?? [])[0] as McTbCompany | undefined;
  // No forward target → leave the call ringing (never answer into dead air);
  // the inbound leg's call.hangup is the missed signal (handleTerminalCallEvent).
  if (!company?.forward_to_cell) return;

  // #43 suspended-tenant gate: a suspended number (canceled → 30-day grace,
  // D6) or a non-live subscription gets NO forwarding — answering + dialing
  // runs two billable Telnyx legs with zero revenue, a cost the SMS side
  // already blocks via the SQL send gate's subscription_status = 'active'
  // check, mirrored here. The call rings out exactly like the no-forward
  // case; its untagged hangup flows through handleTerminalCallEvent as a
  // missed call, where the text-back's own claim RPC applies the same
  // subscription gate. Inbound SMS storage stays live throughout (D6).
  if (
    resolved.status === "suspended" ||
    company.subscription_status !== "active"
  ) {
    return;
  }

  // D36 voice spending cap: between the fair-use allowance and the cap, extra
  // minutes BILL at 1¢/min (metered below on hangup) — but AT the cap
  // (allowance × overage_cap_multiplier, the same owner control that pauses
  // text sending) forwarding pauses so the bill can never run past what the
  // owner allowed. Reject the inbound call; the reject's untagged-leg hangup
  // flows through handleTerminalCallEvent as a missed call, so the caller
  // still gets the "sorry we missed you, text us" SMS (idempotent per call,
  // and only if the owner enabled text-back). The owner was alerted at
  // 80%/100% of the ALLOWANCE by the voice arm of the usage-alerts cron.
  if (await companyOverVoiceCap(db, resolved.companyId, company)) {
    await telnyxRequest(env, {
      method: "POST",
      path: `/v2/calls/${callControlId}/actions/reject`,
      body: { cause: OVER_BUDGET_REJECT_CAUSE },
    });
    return;
  }

  // Answer the inbound leg so we control it (required before we can dial/bridge
  // and before AMD can run on the forward leg).
  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/calls/${callControlId}/actions/answer`,
  });

  // Dial the owner's cell as a second leg with a ring timeout + AMD. The
  // forward leg's terminal signal (hangup cause / AMD result) computes missed.
  // Per the Telnyx transfer contract, `client_state` tags the leg the command
  // is issued ON (the inbound leg) and `target_leg_client_state` tags the NEW
  // dialed leg — so the forward tag (carrying the original caller for a
  // DB-free recovery at terminal time) goes on target_leg_client_state, and
  // the inbound leg gets its own 'forwarded' tag so its later hangup is never
  // misread as a no-forward miss. An anonymous caller (no `from`) still gets
  // forwarded — the owner wants the call — with a caller-less tag, which
  // simply means no text-back can fire later.
  const callerE164 = payload.from;
  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/calls/${callControlId}/actions/transfer`,
    body: {
      to: company.forward_to_cell,
      from: toE164, // present the business number to the owner's cell
      timeout_secs: FORWARD_TIMEOUT_SECS,
      // #12: cap a single forwarded call's billable length (Telnyx ends the leg
      // at this limit) so one long call can't overrun the period voice cap.
      time_limit_secs: MAX_FORWARDED_CALL_SECS,
      answering_machine_detection: "detect_beep",
      client_state: encodeClientState(INBOUND_FORWARDED_STATE),
      target_leg_client_state: callerE164
        ? buildForwardState(callerE164)
        : encodeClientState(FORWARD_LEG_STATE),
    },
  });
}

/**
 * On a terminal call event (hangup or AMD verdict): merge the #129 session-
 * grain `calls` read model, compute missed, thread the call into its
 * conversation, and — when missed — fire the text-back + crew alert. The leg
 * is classified purely from the echoed client_state tag (the routing
 * decision captured at call time — see the module header), so no companies
 * read happens here and a mid-call forward_to_cell settings change cannot
 * flip an in-flight call's computation. Every write below is idempotent
 * (ignoreDuplicates leg rows, convergent session merge, payload-keyed event
 * dedupe, per-call claim), so a thrown error safely replays the whole
 * handler through the webhook sweeper.
 */
async function handleTerminalCallEvent(
  env: Env,
  db: SupabaseClient,
  eventType: string,
  payload: CallPayload,
): Promise<void> {
  const callId = payload.call_session_id;
  if (!callId) return;

  const leg = classifyLeg(payload);

  // Our number, per leg:
  //   - inbound (untagged/forwarded) leg: to = our number, from = the caller.
  //   - forward leg: from = our number (we presented it), to = the owner's cell.
  const forwardLeg = leg === "forward";
  const ourNumberE164 = forwardLeg ? payload.from : payload.to;

  // #12/D36 voice metering: record this leg's billable duration on every
  // hangup — BEFORE the missed-vs-answered branch, because an answered call
  // costs minutes too. AMD events carry no duration window, so only
  // call.hangup records. Forward legs also report their billable seconds to
  // the Stripe voice meter (D36 fair-use overage).
  if (eventType === "call.hangup" && ourNumberE164) {
    await recordCallDuration(env, db, payload, leg, ourNumberE164);
  }

  const outcome = computeMissedFromEvent({
    eventType,
    hangupCause: payload.hangup_cause ?? null,
    amdResult: payload.result ?? null,
    leg,
  });

  // The original caller, per leg: the inbound leg carries it as `from`; the
  // forward leg does not, so it rides the client_state we stamped when dialing.
  const finalCaller = forwardLeg
    ? decodeForwardCaller(payload.client_state ?? null)
    : (payload.from ?? null);

  if (!ourNumberE164) return;
  const resolved = await resolveNumber(db, ourNumberE164);
  if (!resolved) return;

  // #129: merge this event into the session-grain calls row (AMD verdicts,
  // per-leg hangups — convergent whatever order Telnyx delivers them in).
  const call = await upsertCallSession(db, {
    eventType,
    payload,
    leg,
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: callId,
    caller: finalCaller,
    missed: outcome.missed,
  });

  // #129: thread the call on its DECIDING hangup — the forward leg for a
  // forwarded call, the untagged inbound leg for a no-forward/rejected call
  // (the inbound_forwarded leg never decides). Threading precedes the
  // text-back so the timeline reads call-then-text in insertion order.
  if (
    eventType === "call.hangup" &&
    leg !== "inbound_forwarded" &&
    call?.outcome
  ) {
    await threadCallSession(db, {
      companyId: resolved.companyId,
      phoneNumberId: resolved.phoneNumberId,
      callSessionId: callId,
      caller: call.caller_e164 ?? finalCaller,
      outcome: call.outcome,
      forwardSeconds: call.forward_seconds ?? 0,
    });
  }

  if (!outcome.missed || !finalCaller) return;

  await sendMissedCallText(env, db, {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    fromNumberE164: ourNumberE164,
    callerE164: finalCaller,
    callId,
  });
}

interface CallSessionRow {
  id: string;
  caller_e164: string | null;
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number | null;
  conversation_id: string | null;
}

/**
 * #129: merge one webhook event into the session-grain `calls` row via the
 * convergent api_upsert_call RPC. Outcome candidates per event:
 *   - AMD verdict (forward leg): machine/not_human/fax → 'voicemail',
 *     human → 'answered' (the SQL merge lets 'voicemail' beat a hangup's
 *     'answered' fallback, whatever order the webhooks land).
 *   - forward-leg hangup: rang out → 'missed', else 'answered'; carries the
 *     talk-time seconds (ring time is zero, same rule as billing).
 *   - untagged inbound hangup (no-forward / over-cap reject): 'missed'.
 *   - inbound_forwarded hangup: no verdict — contributes the time window only.
 */
async function upsertCallSession(
  db: SupabaseClient,
  input: {
    eventType: string;
    payload: CallPayload;
    leg: CallLeg;
    companyId: string;
    phoneNumberId: string;
    callSessionId: string;
    caller: string | null;
    missed: boolean;
  },
): Promise<CallSessionRow | null> {
  const { eventType, payload, leg } = input;

  let outcome: string | null = null;
  let forwardSeconds = 0;
  if (eventType === "call.machine.detection.ended" && leg === "forward") {
    const amd = payload.result ?? "";
    if (["machine", "not_human", "fax", "fax_detected"].includes(amd)) {
      outcome = "voicemail";
    } else if (amd === "human") {
      outcome = "answered";
    }
  } else if (eventType === "call.hangup") {
    if (leg === "forward") {
      outcome = input.missed ? "missed" : "answered";
      if (!input.missed) {
        const startMs = Date.parse(payload.start_time ?? "");
        const endMs = Date.parse(payload.end_time ?? "");
        if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
          forwardSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
        }
      }
    } else if (leg === "inbound_untagged") {
      outcome = "missed";
    }
  }

  const startMs = Date.parse(payload.start_time ?? "");
  const endMs = Date.parse(payload.end_time ?? "");
  const { data, error } = await db.rpc("api_upsert_call", {
    p_company_id: input.companyId,
    p_phone_number_id: input.phoneNumberId,
    p_call_session_id: input.callSessionId,
    p_caller_e164: input.caller,
    p_outcome: outcome,
    p_forward_seconds: forwardSeconds,
    p_started_at: Number.isFinite(startMs)
      ? new Date(startMs).toISOString()
      : null,
    p_ended_at:
      eventType === "call.hangup" && Number.isFinite(endMs)
        ? new Date(endMs).toISOString()
        : null,
  });
  if (error) {
    throw new Error(`api_upsert_call failed: ${error.message}`);
  }
  return (data as CallSessionRow | null) ?? null;
}

/**
 * #129: thread the finished call into the caller's conversation (missed
 * calls find-or-CREATE — a miss must reach the inbox even with text-back
 * off; answered/voicemail only JOIN an open conversation) and link the ids
 * back onto the calls row. Idempotent end to end.
 */
async function threadCallSession(
  db: SupabaseClient,
  input: {
    companyId: string;
    phoneNumberId: string;
    callSessionId: string;
    caller: string | null;
    outcome: string;
    forwardSeconds: number;
  },
): Promise<void> {
  if (!input.caller) return; // anonymous caller — list-only, never threaded

  const { data, error } = await db.rpc("api_thread_call", {
    p_company_id: input.companyId,
    p_phone_number_id: input.phoneNumberId,
    p_caller_e164: input.caller,
    p_call_session_id: input.callSessionId,
    p_outcome: input.outcome,
    p_forward_seconds: input.forwardSeconds,
    p_create_if_missing: input.outcome === "missed",
  });
  if (error) {
    throw new Error(`api_thread_call failed: ${error.message}`);
  }
  const thread = data as
    | { contact_id?: string; conversation_id?: string }
    | null;
  if (!thread?.conversation_id) return;

  const { error: linkError } = await db
    .from("calls")
    .update({
      contact_id: thread.contact_id ?? null,
      conversation_id: thread.conversation_id,
    })
    .eq("call_session_id", input.callSessionId)
    .is("conversation_id", null);
  if (linkError) {
    throw new Error(`calls link failed: ${linkError.message}`);
  }
}

/**
 * #12/D36: persist one call leg's billable seconds (end − start) to
 * call_records, keyed by call_leg_id so a webhook replay is a no-op. Both
 * legs of a forwarded call are recorded, but ONLY the forward (dialed) leg is
 * the customer-facing measure: its RAW SECONDS count against the fair-use
 * allowance (api_period_forward_seconds) and, when the voice meter is
 * configured, the SAME seconds are reported to Stripe (the metered price
 * rates 1¢ per 60 s), with the leg id as the dedupe identifier — one
 * measure everywhere, so the bill can never diverge from the gate, the
 * alerts, or the usage screen. A forward leg that RANG OUT (never answered,
 * per the same missed-cause classification the text-back uses) records ZERO
 * billable seconds — ring time is not a forwarded minute, whatever window
 * Telnyx stamps on the hangup. Non-reportable rows (inbound legs,
 * zero-second forward legs, meter not configured) are stamped
 * stripe_reported_at at INSERT so the hourly re-reporter's queue only ever
 * holds genuinely billable work — and an environment that configures the
 * meter later can never dump a pre-existing backlog into a current invoice.
 * A Stripe failure after a landed insert is swallowed (the row stays
 * unstamped; crons.ts re-reports), exactly like the segments path in
 * status.ts. Skips silently when the payload has no parseable duration
 * window (nothing to meter) or we don't own the number.
 */
async function recordCallDuration(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
  leg: CallLeg,
  ourNumberE164: string,
): Promise<void> {
  const startMs = Date.parse(payload.start_time ?? "");
  const endMs = Date.parse(payload.end_time ?? "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
  const legId = payload.call_leg_id ?? payload.call_control_id;
  if (!legId) return;

  const resolved = await resolveNumber(db, ourNumberE164);
  if (!resolved) return;

  const windowSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  // D36: a rang-out forward leg is a MISS (same pure classifier the text-back
  // path uses) — it must never consume allowance or bill.
  const rangOut =
    leg === "forward" &&
    computeMissedFromEvent({
      eventType: "call.hangup",
      hangupCause: payload.hangup_cause ?? null,
      amdResult: null,
      leg,
    }).missed;
  const seconds = rangOut ? 0 : windowSeconds;
  const caller =
    leg === "forward"
      ? decodeForwardCaller(payload.client_state ?? null)
      : (payload.from ?? null);

  const reportable =
    leg === "forward" && seconds > 0 && Boolean(env.STRIPE_VOICE_METER_EVENT_NAME);

  const { data: inserted, error } = await db
    .from("call_records")
    .upsert(
      {
        company_id: resolved.companyId,
        phone_number_id: resolved.phoneNumberId,
        call_session_id: payload.call_session_id ?? null,
        call_leg_id: legId,
        leg: leg === "forward" ? "forward" : "inbound",
        caller_e164: caller,
        billable_seconds: seconds,
        hangup_cause: payload.hangup_cause ?? null,
        // D36: only rows with seconds to bill enter the re-reporter's queue.
        stripe_reported_at: reportable ? null : new Date().toISOString(),
      },
      { onConflict: "call_leg_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    throw new Error(`call_records upsert failed: ${error.message}`);
  }
  const rowId = inserted?.[0]?.id as string | undefined;
  // Conflict (webhook replay) → already recorded, and if billable, already
  // reported or queued — never report twice off a replay.
  if (!rowId || !reportable) return;

  await reportForwardLegSeconds(env, db, {
    rowId,
    companyId: resolved.companyId,
    legId,
    seconds,
  });
}

/**
 * D36: fire the voice meter event for a freshly-inserted forward leg, then
 * stamp the row. Mirrors status.ts reportUsageEvent: a missing Stripe
 * customer or a Stripe failure leaves the row unstamped for the hourly
 * re-reporter — the local stamp is the real idempotency gate.
 */
async function reportForwardLegSeconds(
  env: Env,
  db: SupabaseClient,
  input: { rowId: string; companyId: string; legId: string; seconds: number },
): Promise<void> {
  const { data, error } = await db
    .from("companies")
    .select("stripe_customer_id")
    .eq("id", input.companyId)
    .limit(1);
  if (error || !data?.[0]?.stripe_customer_id) return; // cron retries hourly
  const stripeCustomerId = data[0].stripe_customer_id as string;

  try {
    await reportVoiceSeconds(env, {
      stripeCustomerId,
      value: input.seconds,
      identifier: input.legId,
    });
  } catch (cause) {
    // Report failed — leave stripe_reported_at NULL; the hourly re-reporter
    // (messaging/crons.ts) picks the row up with the same identifier.
    console.error(
      `voice meter report failed for ${input.rowId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return;
  }
  const { error: stampError } = await db
    .from("call_records")
    .update({ stripe_reported_at: new Date().toISOString() })
    .eq("id", input.rowId)
    .is("stripe_reported_at", null);
  if (stampError) {
    throw new Error(
      `call_records stripe_reported_at stamp failed: ${stampError.message}`,
    );
  }
}

/**
 * We encode the inbound caller into the forward leg's client_state as
 * `mctb_forward|<caller_e164>` when dialing, so the forward leg's terminal
 * events carry the original caller without any DB round-trip. Returns the caller
 * portion, or null when absent.
 */
function decodeForwardCaller(raw: string | null): string | null {
  const decoded = decodeClientState(raw);
  if (!decoded) return null;
  const [tag, caller] = decoded.split("|");
  return tag === FORWARD_LEG_STATE && caller ? caller : null;
}
