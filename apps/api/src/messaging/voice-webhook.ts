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

import { PLAN_VOICE_MINUTES, type PlanId } from "../billing/plans";
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
 * period voice cap (companyOverVoiceBudget) is a pre-answer boundary check, so
 * a call that answers just under the cap could otherwise run unbounded and blow
 * the period allowance on its own. Telnyx auto-ends the leg at this limit,
 * bounding any one call's cost. 1h is far above a real business call.
 */
export const MAX_FORWARDED_CALL_SECS = 60 * 60;

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

/** Cause we reject an over-voice-budget inbound call with (#12 cap). */
const OVER_BUDGET_REJECT_CAUSE = "USER_BUSY";

interface CompanyVoiceState {
  plan: PlanId | null;
  current_period_start: string | null;
}

/**
 * #12 voice cap: has the company already used its plan's included forwarding
 * minutes this period? Pre-checkout (no plan) or no live period → not over (no
 * allowance to exceed, and no numbers to receive calls anyway). Reads the
 * period-sum RPC over call_records (both legs of every forwarded call).
 */
async function companyOverVoiceBudget(
  db: SupabaseClient,
  companyId: string,
  company: CompanyVoiceState,
): Promise<boolean> {
  if (!company.plan || !company.current_period_start) return false;
  const { data, error } = await db.rpc("api_period_voice_seconds", {
    p_company_id: companyId,
    p_since: company.current_period_start,
  });
  if (error) {
    throw new Error(`voice usage lookup failed: ${error.message}`);
  }
  return Number(data) >= PLAN_VOICE_MINUTES[company.plan] * 60;
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
): Promise<{ companyId: string; phoneNumberId: string } | null> {
  const { data, error } = await db
    .from("phone_numbers")
    .select("id,company_id")
    .eq("number_e164", toE164)
    .neq("status", "released")
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; company_id: string } | undefined;
  return row ? { companyId: row.company_id, phoneNumberId: row.id } : null;
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
    .select("id,forward_to_cell,plan,current_period_start")
    .eq("id", resolved.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }
  const company = (companyRows ?? [])[0] as McTbCompany | undefined;
  // No forward target → leave the call ringing (never answer into dead air);
  // the inbound leg's call.hangup is the missed signal (handleTerminalCallEvent).
  if (!company?.forward_to_cell) return;

  // #12 voice cap-and-drop: over the plan's forwarding-minute allowance → do
  // NOT forward (forwarding runs two billable legs and there's no voice-overage
  // billing yet, so we'd eat it). Reject the inbound call instead; the reject's
  // untagged-leg hangup flows through handleTerminalCallEvent as a missed call,
  // so the caller still gets the "sorry we missed you, text us" SMS (idempotent
  // per call, and only if the owner enabled text-back). The owner was warned at
  // 80% by the voice arm of the usage-alerts cron.
  if (await companyOverVoiceBudget(db, resolved.companyId, company)) {
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
 * On a terminal call event (hangup or AMD verdict): compute missed and, when
 * missed, fire the text-back + crew alert. The leg is classified purely from
 * the echoed client_state tag (the routing decision captured at call time —
 * see the module header), so no companies read happens here and a mid-call
 * forward_to_cell settings change cannot flip an in-flight call's computation.
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

  // #12 voice metering: record this leg's billable duration on every hangup —
  // BEFORE the missed-vs-answered branch, because an answered call costs minutes
  // too. AMD events carry no duration window, so only call.hangup records.
  if (eventType === "call.hangup" && ourNumberE164) {
    await recordCallDuration(db, payload, leg, ourNumberE164);
  }

  const outcome = computeMissedFromEvent({
    eventType,
    hangupCause: payload.hangup_cause ?? null,
    amdResult: payload.result ?? null,
    leg,
  });
  if (!outcome.missed) return;

  // The original caller, per leg: the inbound leg carries it as `from`; the
  // forward leg does not, so it rides the client_state we stamped when dialing.
  const finalCaller = forwardLeg
    ? decodeForwardCaller(payload.client_state ?? null)
    : payload.from;
  if (!ourNumberE164 || !finalCaller) return;

  const resolved = await resolveNumber(db, ourNumberE164);
  if (!resolved) return;

  await sendMissedCallText(env, db, {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    fromNumberE164: ourNumberE164,
    callerE164: finalCaller,
    callId,
  });
}

/**
 * #12: persist one forwarded-call leg's billable seconds (end − start) to
 * call_records, keyed by call_leg_id so a webhook replay is a no-op. Both legs
 * of a forwarded call are recorded; api_period_voice_seconds sums them for the
 * cap + owner alerts. Skips silently when the payload has no parseable duration
 * window (nothing to meter) or we don't own the number.
 */
async function recordCallDuration(
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

  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const caller =
    leg === "forward"
      ? decodeForwardCaller(payload.client_state ?? null)
      : (payload.from ?? null);

  const { error } = await db.from("call_records").upsert(
    {
      company_id: resolved.companyId,
      phone_number_id: resolved.phoneNumberId,
      call_session_id: payload.call_session_id ?? null,
      call_leg_id: legId,
      leg: leg === "forward" ? "forward" : "inbound",
      caller_e164: caller,
      billable_seconds: seconds,
      hangup_cause: payload.hangup_cause ?? null,
    },
    { onConflict: "call_leg_id", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`call_records upsert failed: ${error.message}`);
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
