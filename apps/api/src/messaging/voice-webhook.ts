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
    .select("id,forward_to_cell")
    .eq("id", resolved.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }
  const company = (companyRows ?? [])[0] as McTbCompany | undefined;
  // No forward target → leave the call ringing (never answer into dead air);
  // the inbound leg's call.hangup is the missed signal (handleTerminalCallEvent).
  if (!company?.forward_to_cell) return;

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

  const outcome = computeMissedFromEvent({
    eventType,
    hangupCause: payload.hangup_cause ?? null,
    amdResult: payload.result ?? null,
    leg,
  });
  if (!outcome.missed) return;

  // Our number + the original caller, per leg:
  //   - inbound (untagged) leg: to = our number, from = the caller.
  //   - forward leg: from = our number (we presented it), to = the owner's
  //     cell, and the ORIGINAL caller rides the client_state we stamped when
  //     dialing (this payload never carries it).
  const forwardLeg = leg === "forward";
  const ourNumberE164 = forwardLeg ? payload.from : payload.to;
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
