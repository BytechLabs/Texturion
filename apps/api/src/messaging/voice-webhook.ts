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
import { notifyMissedCall } from "../notifications/missed-call";
import { telnyxRequest } from "../telnyx/client";
import { computeMissedFromEvent } from "./missed-call";
import { sendMissedCallText } from "./missed-call";
import type { TelnyxEvent } from "./types";

/** The client_state tag we stamp on the forward (dial) leg. */
export const FORWARD_LEG_STATE = "mctb_forward";

/** The client_state tag we stamp on the INBOUND leg when we forward it. */
export const INBOUND_FORWARDED_STATE = "mctb_inbound_fwd";

/** D38 outbound bridge: the AGENT leg (the member's cell we ring first).
 *  client_state = `oc_agent|<customer_e164>` — the customer rides along so
 *  no DB read is needed at verdict/terminal time. */
export const OUTBOUND_AGENT_STATE = "oc_agent";

/** D38 outbound bridge: the CUSTOMER leg (the transfer target). */
export const OUTBOUND_CUSTOMER_STATE = "oc_customer";

/** Ring window for the outbound agent leg (the member expects the call). */
export const OUTBOUND_AGENT_TIMEOUT_SECS = 25;

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

export interface CompanyVoiceState {
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
export async function companyOverVoiceCap(
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
export type CallLeg =
  | "forward"
  | "inbound_forwarded"
  | "inbound_untagged"
  // D38 outbound bridge legs:
  | "out_agent"
  | "out_customer";

function classifyLeg(payload: CallPayload): CallLeg {
  const decoded = decodeClientState(payload.client_state);
  const tag = decoded?.split("|")[0];
  if (tag === FORWARD_LEG_STATE) return "forward";
  if (tag === INBOUND_FORWARDED_STATE) return "inbound_forwarded";
  if (tag === OUTBOUND_AGENT_STATE) return "out_agent";
  if (tag === OUTBOUND_CUSTOMER_STATE) return "out_customer";
  return "inbound_untagged";
}

/** D38: the customer number both outbound tags carry (`tag|<customer>`). */
function decodeOutboundCustomer(raw: string | null | undefined): string | null {
  const decoded = decodeClientState(raw ?? null);
  if (!decoded) return null;
  const [tag, customer] = decoded.split("|");
  return (tag === OUTBOUND_AGENT_STATE || tag === OUTBOUND_CUSTOMER_STATE) &&
    customer
    ? customer
    : null;
}

/** D38: build the tagged client_state for an outbound leg. */
export function buildOutboundState(
  tag: typeof OUTBOUND_AGENT_STATE | typeof OUTBOUND_CUSTOMER_STATE,
  customerE164: string,
): string {
  return btoa(`${tag}|${customerE164}`);
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
  // D38: the outbound AGENT leg's AMD verdict is a ROUTING decision, not a
  // terminal one — human/undetermined bridges to the customer, a machine
  // (the member's own voicemail) hangs up so voicemail can never be
  // connected to a customer.
  if (
    eventType === "call.machine.detection.ended" &&
    classifyLeg(payload) === "out_agent"
  ) {
    return handleOutboundAgentVerdict(env, db, payload);
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
 * D38: the outbound agent leg answered and AMD spoke. Human (or undetermined
 * — never strand a member who answered) → transfer to the customer,
 * presenting the business number, with the customer tag on the new leg.
 * Machine → the member's own voicemail picked up: hang up. The hangup that
 * follows flows through the terminal handler and marks the session 'missed'
 * (never connected).
 */
async function handleOutboundAgentVerdict(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
): Promise<void> {
  const callControlId = payload.call_control_id;
  const customer = decodeOutboundCustomer(payload.client_state);
  const businessNumber = payload.from;
  if (!callControlId || !customer || !businessNumber) return;

  const machine = ["machine", "not_human", "fax", "fax_detected"].includes(
    payload.result ?? "",
  );
  if (machine) {
    // Mark the session never-connected BEFORE hanging up (the hangup that
    // follows carries normal_clearing, which must not read as 'answered').
    if (payload.call_session_id) {
      const resolved = payload.from
        ? await resolveNumber(db, payload.from)
        : null;
      if (resolved) {
        await upsertCallSession(db, {
          eventType: "call.machine.detection.ended",
          payload,
          leg: "out_agent",
          companyId: resolved.companyId,
          phoneNumberId: resolved.phoneNumberId,
          callSessionId: payload.call_session_id,
          caller: customer,
          missed: true,
        });
      }
    }
    await telnyxRequest(env, {
      method: "POST",
      path: `/v2/calls/${callControlId}/actions/hangup`,
      body: {},
    });
    return;
  }

  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/calls/${callControlId}/actions/transfer`,
    body: {
      to: customer,
      from: businessNumber, // the customer sees the business number
      timeout_secs: OUTBOUND_AGENT_TIMEOUT_SECS,
      time_limit_secs: MAX_FORWARDED_CALL_SECS,
      client_state: buildOutboundState(OUTBOUND_AGENT_STATE, customer),
      target_leg_client_state: buildOutboundState(
        OUTBOUND_CUSTOMER_STATE,
        customer,
      ),
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
  const outboundLeg = leg === "out_agent" || leg === "out_customer";

  // Our number, per leg:
  //   - inbound (untagged/forwarded) leg: to = our number, from = the caller.
  //   - forward leg + BOTH outbound legs: from = our number (we present it),
  //     to = the cell (forward/out_agent) or the customer (out_customer).
  const forwardLeg = leg === "forward";
  const ourNumberE164 =
    forwardLeg || outboundLeg ? payload.from : payload.to;

  // #12/D36 voice metering: record this leg's billable duration on every
  // hangup — BEFORE the missed-vs-answered branch, because an answered call
  // costs minutes too. AMD events carry no duration window, so only
  // call.hangup records. The far-party legs (forward, out_customer) also
  // report their billable seconds to the Stripe voice meter (D36/D38: one
  // calling-minutes pool, both directions).
  if (eventType === "call.hangup" && ourNumberE164) {
    await recordCallDuration(env, db, payload, leg, ourNumberE164);
  }

  // The missed-cause classification. The pure classifier's leg semantics are
  // the INBOUND wave's; outbound legs borrow the 'forward' cause table
  // (timeout/busy/declined = not connected) while keeping their real leg for
  // all routing below.
  const outcome = computeMissedFromEvent({
    eventType,
    hangupCause: payload.hangup_cause ?? null,
    amdResult: payload.result ?? null,
    leg: outboundLeg ? "forward" : leg,
  });

  // The far party, per leg: inbound legs carry the caller as `from`; the
  // forward leg and both outbound legs carry it in their client_state tag.
  const finalCaller = forwardLeg
    ? decodeForwardCaller(payload.client_state ?? null)
    : outboundLeg
      ? decodeOutboundCustomer(payload.client_state)
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

  // #129/D38: thread the call on its DECIDING hangup — the forward leg for a
  // forwarded call, the untagged inbound leg for a no-forward/rejected call,
  // the CUSTOMER leg for an outbound call (an agent-only failure — the
  // member didn't pick up their own phone — stays list-only; the customer
  // was never contacted). Threading precedes the text-back so the timeline
  // reads call-then-text in insertion order.
  const decidingHangup =
    eventType === "call.hangup" &&
    (leg === "forward" || leg === "inbound_untagged" || leg === "out_customer");
  let thread: ThreadCallResult | null = null;
  if (decidingHangup && call?.outcome) {
    thread = await threadCallSession(db, {
      companyId: resolved.companyId,
      phoneNumberId: resolved.phoneNumberId,
      callSessionId: callId,
      caller: call.caller_e164 ?? finalCaller,
      outcome: call.outcome,
      forwardSeconds: call.forward_seconds ?? 0,
      direction: outboundLeg ? "outbound" : "inbound",
    });
  }

  // The missed-call text-back is an INBOUND behavior only — an outbound
  // no-answer must never text the customer "sorry we missed you".
  if (outboundLeg || !outcome.missed || !finalCaller) return;

  const textBack = await sendMissedCallText(env, db, {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    fromNumberE164: ourNumberE164,
    callerE164: finalCaller,
    callId,
  });

  // #132: the crew alert is a MISSED-CALL behavior, not a TEXT-BACK behavior —
  // with MCTB off/unauthored (or the caller opted out / throttled) the team
  // must still learn a call went unanswered. When the text-back path already
  // alerted (its claim makes that exactly-once, surviving ledger replays), we
  // are done; otherwise fire here, gated on the timeline event INSERT — true
  // exactly once per call session, so a Telnyx redelivery never re-alerts.
  // Best-effort like every §8 alert: the durable record is the timeline event
  // (which also feeds the D24 bell); push/email failure never fails the hook.
  if (!textBack.alerted && thread?.eventInserted && thread.conversationId) {
    try {
      await notifyMissedCall(
        env,
        {
          companyId: resolved.companyId,
          conversationId: thread.conversationId,
          callerE164: call?.caller_e164 ?? finalCaller,
          textStatus: "none",
        },
        db,
      );
    } catch (cause) {
      console.error(
        `missed-call alert for conversation ${thread.conversationId} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
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
  const outbound = leg === "out_agent" || leg === "out_customer";

  let outcome: string | null = null;
  let forwardSeconds = 0;
  if (eventType === "call.machine.detection.ended") {
    const amd = payload.result ?? "";
    const machine = ["machine", "not_human", "fax", "fax_detected"].includes(amd);
    if (leg === "forward") {
      if (machine) outcome = "voicemail";
      else if (amd === "human") outcome = "answered";
    } else if (leg === "out_agent" && machine) {
      // D38: the member's own voicemail answered the agent leg — the bridge
      // is aborted (handleOutboundAgentVerdict hangs up) and the customer
      // was never dialed.
      outcome = "missed";
    }
  } else if (eventType === "call.hangup") {
    if (leg === "forward" || leg === "out_customer") {
      // The far-party leg decides: connected (with talk time) or not.
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
    } else if (leg === "out_agent" && input.missed) {
      // D38: the member never picked up their own cell (timeout/decline) —
      // the customer was never dialed. 'missed' = never connected; a
      // normal_clearing agent hangup at the END of a bridged call carries no
      // verdict (the customer leg already decided).
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
    p_direction: outbound ? "outbound" : "inbound",
  });
  if (error) {
    throw new Error(`api_upsert_call failed: ${error.message}`);
  }
  return (data as CallSessionRow | null) ?? null;
}

/** What threading decided — the caller alert keys off the event INSERT. */
interface ThreadCallResult {
  conversationId: string | null;
  /** True exactly once per call session: this pass inserted the timeline
   *  event (the per-call claim for the #132 crew alert). */
  eventInserted: boolean;
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
    direction: "inbound" | "outbound";
  },
): Promise<ThreadCallResult | null> {
  if (!input.caller) return null; // anonymous caller — list-only, never threaded

  const { data, error } = await db.rpc("api_thread_call", {
    p_company_id: input.companyId,
    p_phone_number_id: input.phoneNumberId,
    p_caller_e164: input.caller,
    p_call_session_id: input.callSessionId,
    p_outcome: input.outcome,
    p_forward_seconds: input.forwardSeconds,
    // An inbound MISS must reach the inbox even with text-back off; an
    // outbound call started FROM a conversation, so join-only always finds it.
    p_create_if_missing:
      input.direction === "inbound" && input.outcome === "missed",
    p_direction: input.direction,
  });
  if (error) {
    throw new Error(`api_thread_call failed: ${error.message}`);
  }
  const thread = data as
    | { contact_id?: string; conversation_id?: string; event_inserted?: boolean }
    | null;
  if (!thread?.conversation_id) return null;

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
  return {
    conversationId: thread.conversation_id,
    eventInserted: thread.event_inserted === true,
  };
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
  // D36/D38: the BILLED legs are the far-party legs — 'forward' (inbound
  // calls) and 'out_customer' (outbound calls). A rang-out far-party leg is
  // a MISS (same pure cause table the text-back path uses) — it must never
  // consume allowance or bill.
  const billedLeg = leg === "forward" || leg === "out_customer";
  const rangOut =
    billedLeg &&
    computeMissedFromEvent({
      eventType: "call.hangup",
      hangupCause: payload.hangup_cause ?? null,
      amdResult: null,
      leg: "forward",
    }).missed;
  const seconds = rangOut ? 0 : windowSeconds;
  const caller =
    leg === "forward"
      ? decodeForwardCaller(payload.client_state ?? null)
      : leg === "out_agent" || leg === "out_customer"
        ? decodeOutboundCustomer(payload.client_state)
        : (payload.from ?? null);

  const reportable =
    billedLeg && seconds > 0 && Boolean(env.STRIPE_VOICE_METER_EVENT_NAME);

  const { data: inserted, error } = await db
    .from("call_records")
    .upsert(
      {
        company_id: resolved.companyId,
        phone_number_id: resolved.phoneNumberId,
        call_session_id: payload.call_session_id ?? null,
        call_leg_id: legId,
        leg:
          leg === "forward" || leg === "out_agent" || leg === "out_customer"
            ? leg
            : "inbound",
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
