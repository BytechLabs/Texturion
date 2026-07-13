/**
 * Call-Control webhook handler, dispatched from /webhooks/telnyx on `call.*`
 * event types (same verified, ledgered, ack-then-waitUntil path the
 * messaging webhooks use).
 *
 * D43 (#135): the browser is the phone. An INBOUND call to a company number
 * rings every eligible member's WebRTC leg (the ring engine —
 * ./inbound-ring); unanswered calls take a voicemail; the missed text-back
 * fires for every unanswered path. Cell forwarding and the D38 cell bridge
 * are DELETED — no call ever dials a personal cell.
 *
 * Leg classification is purely from the echoed client_state tag (the routing
 * decision captured at call time): 'brm' member ring legs, 'bri' the inbound
 * leg once a browser answered it (the tag carries the answer timestamp — the
 * talk-time/billing anchor), 'vmi' the inbound leg in voicemail, 'oc_agent'/
 * 'oc_customer' outbound legs, and NO tag = the raw inbound customer leg
 * (its hangup with nobody answered IS the miss). The legacy 'mctb_forward'/
 * 'mctb_inbound_fwd' tags remain classifiable so any call in flight across
 * the D43 deploy still terminates correctly; nothing creates them anymore.
 *
 * "Missed" is COMPUTED per {@link computeMissedFromEvent} — never a bare
 * hangup on an answered call. Idempotency is per call_session_id at the
 * claim RPC, so a retried webhook never double-texts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { reportVoiceSeconds } from "../billing/meter";
import {
  PLAN_VOICE_MINUTES,
  type PlanId,
} from "../billing/plans";
import { getDb } from "../db";
import type { Env } from "../env";
import { notifyMissedCall } from "../notifications/missed-call";
import { TelnyxApiError, telnyxRequest } from "../telnyx/client";
import {
  BROWSER_INBOUND_STATE,
  BROWSER_MEMBER_STATE,
  VOICEMAIL_INBOUND_STATE,
  cancelRingingMemberLegs,
  deleteTelnyxRecording,
  handleMemberRingAnswered,
  handleMemberRingHangup,
  handleVoicemailSpeakEnded,
  insertVoicemailEvent,
  parseBrowserAnsweredAtMs,
  parseMemberRingState,
  recoverStoredVoicemail,
  ringMembersOrVoicemail,
  startVoicemail,
  screeningFlagged,
  storeVoicemailRecording,
} from "./inbound-ring";
import {
  CONSULT_LEG_STATE,
  TRANSFER_TARGET_STATE,
  handleConsultLegEvent,
  handleTransferAnswered,
  handleTransferLegHangup,
  parseConsultState,
  parseTransferState,
} from "./live-call";
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

/** Hard ceiling on any single leg's BILLABLE seconds — a defense-in-depth
 *  sanity bound (4h, well above the 2h runaway-call hangup) so a garbage or
 *  attacker-controlled talk-time anchor can never bill an absurd amount. */
const MAX_BILLABLE_SECONDS = 4 * 60 * 60;

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
  // D43 phase 2 — inbound call.initiated extras (all optional; absent when
  // the number-level feature is off or Telnyx has nothing to say):
  call_screening_result?: string; // native inbound_call_screening verdict
  shaken_stir_attestation?: string; // STIR/SHAKEN A/B/C
  caller_id_name?: string; // CNAM dip result
  // call.recording.saved:
  recording_urls?: { mp3?: string; wav?: string };
  recording_started_at?: string;
  recording_ended_at?: string;
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
  // #134/D42: calling is included on every plan — the grandfathered legacy
  // pause line retired with the module; every workspace gets the plan
  // allowance × cap multiplier.

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

/** Which leg an event belongs to, from its echoed client_state tag alone. */
export type CallLeg =
  | "forward"
  | "inbound_forwarded"
  | "inbound_untagged"
  // D38 outbound bridge legs:
  | "out_agent"
  | "out_customer"
  // D43 phase 2 — browser answering:
  | "browser_member" // a member's WebRTC ring leg ('brm')
  | "in_browser" // the INBOUND leg after a browser answered it ('bri')
  | "vm_inbound" // the INBOUND leg once it entered voicemail ('vmi')
  // D43 phase 3 — live-call handling:
  | "transfer_target" // a transfer's new member leg ('brt')
  | "consult"; // an announce-transfer consult leg ('brc')

function classifyLeg(payload: CallPayload): CallLeg {
  const decoded = decodeClientState(payload.client_state);
  const tag = decoded?.split("|")[0];
  if (tag === FORWARD_LEG_STATE) return "forward";
  if (tag === INBOUND_FORWARDED_STATE) return "inbound_forwarded";
  if (tag === OUTBOUND_AGENT_STATE) return "out_agent";
  if (tag === OUTBOUND_CUSTOMER_STATE) return "out_customer";
  if (tag === BROWSER_MEMBER_STATE) return "browser_member";
  if (tag === BROWSER_INBOUND_STATE) return "in_browser";
  if (tag === VOICEMAIL_INBOUND_STATE) return "vm_inbound";
  if (tag === TRANSFER_TARGET_STATE) return "transfer_target";
  if (tag === CONSULT_LEG_STATE) return "consult";
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

/** Build the tagged client_state for an outbound leg. A browser-originated
 *  oc_customer leg also carries the single-use authorization NONCE minted by
 *  POST /v1/calls/browser (`oc_customer|<customer>|<nonce>`) — the webhook
 *  requires it to authorize the call (D43 cross-tenant/forgery fix). */
export function buildOutboundState(
  tag: typeof OUTBOUND_AGENT_STATE | typeof OUTBOUND_CUSTOMER_STATE,
  customerE164: string,
  nonce?: string,
): string {
  return btoa(nonce ? `${tag}|${customerE164}|${nonce}` : `${tag}|${customerE164}`);
}

/** The authorization nonce a browser-originated oc_customer leg carries
 *  (`oc_customer|<customer>|<nonce>`), or null when absent (a forged/omitted
 *  tag — the webhook then rejects the leg). */
function parseOutboundNonce(raw: string | null | undefined): string | null {
  const decoded = decodeClientState(raw ?? null);
  if (!decoded) return null;
  const parts = decoded.split("|");
  return parts[0] === OUTBOUND_CUSTOMER_STATE && parts[2] ? parts[2] : null;
}

interface InboundCompany {
  id: string;
  name: string;
  plan: PlanId | null;
  current_period_start: string | null;
  overage_cap_multiplier: number | string | null;
  subscription_status: string;
  call_screening: "off" | "flag" | "divert";
  voicemail_greeting: string | null;
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
    if (payload.direction === "outgoing") {
      // Distinguish our OWN server-issued legs from browser-originated ones by
      // the DIAL TARGET, not the client_state tag — the browser controls the
      // tag (it could forge a brm/brc/brt tag). Every leg WE place (member
      // rings, consult, transfer targets) dials a Telnyx CREDENTIAL URI
      // (sip:<username>@sip.telnyx.com, a WebRTC-registered username — never a
      // phone number). Requiring the sip.telnyx.com host AND a non-numeric
      // user part means a browser can't reach the PSTN by crafting
      // `sip:+15551234567@sip.telnyx.com` — that is gated like any PSTN call.
      const to = payload.to ?? "";
      if (
        to.startsWith("sip:") &&
        to.includes("@sip.telnyx.com") &&
        !/^sip:\+?\d/.test(to)
      ) {
        return;
      }
      // Any outgoing leg to a PSTN number is browser-originated and MUST pass
      // the server-side gate (cap / subscription / number ownership) before it
      // can bridge to the carrier — the softphone sets its own client_state,
      // so the gate can never trust the tag. Only a properly oc_customer-tagged
      // leg is trackable/billable; anything else is rejected outright.
      return handleOutboundInitiated(
        env,
        db,
        payload,
        classifyLeg(payload) === "out_customer",
      );
    }
    return handleInboundInitiated(env, db, payload);
  }

  const leg = classifyLeg(payload);

  // D43: member browser ring legs never reach the terminal handler — their
  // whole lifecycle (answer race, last-leg voicemail) is the ring engine's,
  // and they must never bill, thread, or text-back.
  if (leg === "browser_member") {
    const state = parseMemberRingState(payload.client_state);
    if (!state || !payload.call_control_id) return;
    if (eventType === "call.answered") {
      return handleMemberRingAnswered(env, db, payload.call_control_id, state);
    }
    if (eventType === "call.hangup") {
      return handleMemberRingHangup(env, db, payload.call_control_id, state);
    }
    return;
  }

  // D43 phase 3: transfer target legs — answer stamps the new owner +
  // journey line; a MISSED transfer auto-recovers (snap back to the sender,
  // voicemail at the hop cap). These legs never bill or thread themselves.
  if (leg === "transfer_target") {
    const state = parseTransferState(payload.client_state);
    if (!state) return;
    if (eventType === "call.answered") {
      return handleTransferAnswered(db, state, payload.call_control_id);
    }
    if (eventType === "call.hangup") {
      const missed = computeMissedFromEvent({
        eventType,
        hangupCause: payload.hangup_cause ?? null,
        amdResult: null,
        leg: "forward",
      }).missed;
      return handleTransferLegHangup(env, db, state, missed);
    }
    return;
  }

  // D43 phase 3: consult legs (the member-to-member announce call). Answer
  // marks the ledger and bridges when both sides are up; hangup dismisses
  // the sibling. Never bills, never threads.
  if (leg === "consult") {
    const state = parseConsultState(payload.client_state);
    if (!state || !payload.call_control_id) return;
    if (eventType === "call.answered" || eventType === "call.hangup") {
      return handleConsultLegEvent(
        env,
        db,
        eventType,
        payload.call_control_id,
        state,
      );
    }
    return;
  }

  // D43 voicemail pipeline: greeting finished → open the recorder; recording
  // saved → copy into our storage, upgrade the outcome, thread the message.
  if (
    eventType === "call.speak.ended" &&
    leg === "vm_inbound" &&
    payload.call_control_id
  ) {
    return handleVoicemailSpeakEnded(env, payload.call_control_id);
  }
  if (eventType === "call.recording.saved" && leg === "vm_inbound") {
    return handleVoicemailSaved(env, db, payload);
  }

  // D43: the outbound customer leg answered — stamp answered_at so the call
  // is transferable (requireLiveCall needs it) AND so billing anchors on
  // talk time, not the ring window (mirrors the inbound bri anchor).
  if (
    eventType === "call.answered" &&
    leg === "out_customer" &&
    payload.call_session_id
  ) {
    return stampOutboundAnswered(db, payload.call_session_id);
  }

  // D38: the outbound AGENT leg's AMD verdict is a ROUTING decision, not a
  // terminal one — human/undetermined bridges to the customer, a machine
  // (the member's own voicemail) hangs up so voicemail can never be
  // connected to a customer.
  if (eventType === "call.machine.detection.ended" && leg === "out_agent") {
    return handleOutboundAgentVerdict(env, db, payload);
  }
  if (
    eventType === "call.hangup" ||
    eventType === "call.machine.detection.ended"
  ) {
    // The caller giving up mid-ring must stop every browser still ringing —
    // BEFORE the terminal merge, so members' screens clear the instant the
    // call dies, not after our bookkeeping.
    if (
      eventType === "call.hangup" &&
      leg === "inbound_untagged" &&
      payload.call_session_id
    ) {
      await cancelRingingMemberLegs(env, db, payload.call_session_id);
    }
    return handleTerminalCallEvent(env, db, eventType, payload);
  }
  // call.answered and other lifecycle events are acked no-ops.
}

/**
 * D43: a voicemail recording landed. Store it (our bucket, Telnyx copy
 * deleted), upgrade the session outcome to 'voicemail' (the merge rule lets
 * it beat the hangup's 'missed' in either arrival order), thread the call if
 * the miss-path hasn't already, and drop the voicemail timeline line.
 */
async function handleVoicemailSaved(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
): Promise<void> {
  const sessionId = payload.call_session_id;
  if (!sessionId) return;

  // Resolve the company + number + caller from OUR calls row (keyed by the
  // session), NOT from payload.to/from — call.recording.saved does not
  // reliably carry those fields, and the calls row is our source of truth
  // (created with phone_number_id + caller_e164 at call.initiated). Depending
  // on the payload here silently killed the whole voicemail pipeline.
  const { data: callRows, error: callError } = await db
    .from("calls")
    .select("company_id,phone_number_id,caller_e164,voicemail_path,voicemail_seconds")
    .eq("call_session_id", sessionId)
    .limit(1);
  if (callError) {
    throw new Error(`voicemail calls lookup failed: ${callError.message}`);
  }
  const row = callRows?.[0] as
    | {
        company_id: string;
        phone_number_id: string | null;
        caller_e164: string | null;
        voicemail_path: string | null;
        voicemail_seconds: number | null;
      }
    | undefined;
  if (!row?.phone_number_id) return; // unknown/released number → drop
  const resolved = {
    companyId: row.company_id,
    phoneNumberId: row.phone_number_id,
  };

  // Hang up the voicemail leg FIRST — before any store that could throw. The
  // recording is already finalized at Telnyx (that's what fired this event),
  // and the presigned mp3 URL is independent of the leg being alive, so
  // terminating it here never breaks the fetch below. Doing it first
  // guarantees a silent-caller inbound leg (a robocaller holding the line past
  // the recorder's silence/max-length stop) is closed even if the store then
  // throws and the whole handler replays — an uncapped PSTN cost center
  // otherwise.
  if (payload.call_control_id) {
    await telnyxRejectLeg(env, payload.call_control_id);
  }

  // Replay recovery: if a prior pass already stored the audio in OUR bucket
  // (voicemail_path stamped) but threw before threading, reconstruct from the
  // calls row WITHOUT re-fetching Telnyx (its copy may already be gone) so the
  // downstream idempotent writes complete on this replay.
  const stored = row.voicemail_path
    ? recoverStoredVoicemail(
        resolved,
        sessionId,
        row.caller_e164,
        row.voicemail_seconds,
      )
    : await storeVoicemailRecording(env, db, payload, resolved, row.caller_e164);
  if (!stored) {
    // Nothing kept (too short / unfetchable) — the call stays an honest miss.
    // The Telnyx copy was already deleted on those paths inside store*.
    return;
  }

  const call = await upsertCallSession(db, {
    eventType: "call.recording.saved",
    payload,
    leg: "vm_inbound",
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: sessionId,
    caller: stored.caller ?? row.caller_e164,
    missed: true,
  });

  // Thread (idempotent — the vmi hangup usually got here first) and fetch
  // the conversation for the voicemail line. Anonymous callers stay
  // list-only, same rule as every other call.
  const thread = await threadCallSession(db, {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: sessionId,
    caller: call?.caller_e164 ?? stored.caller,
    outcome: "voicemail",
    forwardSeconds: 0,
    direction: "inbound",
  });
  const conversationId = thread?.conversationId ?? call?.conversation_id;
  if (conversationId) {
    await insertVoicemailEvent(db, {
      companyId: resolved.companyId,
      conversationId,
      callSessionId: sessionId,
      caller: call?.caller_e164 ?? stored.caller,
      seconds: stored.seconds,
    });
  }

  // ONLY now — after the outcome, thread, and timeline line are durable —
  // delete the Telnyx copy. A replay before this point re-fetches (or recovers
  // from our bucket) and completes; a replay after finds the copy gone AND the
  // writes already done (idempotent), so nothing is lost.
  await deleteTelnyxRecording(env, sessionId);
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

/** In-flight window for the line-busy read: an outcome-less calls row older
 *  than this is a crashed session, not a live call — never wedge the line. */
const LINE_BUSY_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * D43 phase 3: the outbound customer leg's call.initiated — create the
 * in-flight session row so the line reads busy for its whole life (the
 * browser endpoint's guard and the inbound busy check both scan outcome-null
 * rows). The customer leg's control id lands too (phase-3 hold/transfer act
 * on it). Idempotent: api_upsert_call merges per session.
 */
async function handleOutboundInitiated(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
  hasOutboundTag: boolean,
): Promise<void> {
  const sessionId = payload.call_session_id;
  const callControlId = payload.call_control_id;
  const businessNumberE164 = payload.from; // we present the business number
  if (!sessionId || !callControlId || !businessNumberE164) return;

  // SECURITY (D43): the browser ORIGINATES the outbound WebRTC leg itself, so
  // the webhook cannot see WHO placed it — only the presented caller number.
  // The AUTHORIZATION is a single-use nonce that POST /v1/calls/browser minted
  // AFTER proving the authenticated member has 'text' access (#106) to THEIR
  // OWN company's number, with a live subscription and under the voice cap.
  // api_authorize_outbound_call consumes that nonce IFF it was minted for
  // exactly this presented caller number (from) and is fresh, and binds the
  // call to the AUTHORIZED company/number — never the browser-presented one.
  // This closes ALL of: cross-tenant caller-ID billing (a member can only mint
  // a nonce for their own company's numbers), the note-only #106 bypass (a
  // note-only member can't mint one at all), and the forged/omitted tag (no
  // valid nonce → rejected).
  const nonce = parseOutboundNonce(payload.client_state);
  if (!hasOutboundTag || !nonce) {
    await telnyxRejectLeg(env, callControlId);
    return;
  }
  const customerE164 =
    decodeOutboundCustomer(payload.client_state) ?? payload.to ?? "";
  const { data: authData, error: authError } = await db.rpc(
    "api_authorize_outbound_call",
    {
      p_nonce: nonce,
      p_from: businessNumberE164,
      p_customer: customerE164,
      p_call_session_id: sessionId,
      p_max_age_secs: OUTBOUND_AUTH_MAX_AGE_SECS,
    },
  );
  if (authError) {
    throw new Error(`outbound authorize failed: ${authError.message}`);
  }
  const auth = (authData ?? {}) as {
    authorized?: boolean;
    company_id?: string;
    phone_number_id?: string;
    replay?: boolean;
  };
  if (!auth.authorized || !auth.company_id || !auth.phone_number_id) {
    // No valid authorization (forged/omitted/expired nonce, a mismatched
    // caller number, or a leg that skipped /calls/browser) — refuse it.
    await telnyxRejectLeg(env, callControlId);
    return;
  }

  // Defense in depth: a subscription that LAPSED between authorize and dial
  // must not connect (the authorize gate ran a beat ago, but state can move).
  // Keyed on the AUTHORIZED company, never the presented number.
  if (!auth.replay) {
    const { data: companyRows, error: companyError } = await db
      .from("companies")
      .select("plan,current_period_start,overage_cap_multiplier,subscription_status")
      .eq("id", auth.company_id)
      .limit(1);
    if (companyError) {
      throw new Error(`outbound company lookup failed: ${companyError.message}`);
    }
    const company = (companyRows ?? [])[0] as
      | (CompanyVoiceState & { subscription_status: string })
      | undefined;
    if (
      !company ||
      company.subscription_status !== "active" ||
      (await companyOverVoiceCap(db, auth.company_id, company))
    ) {
      await telnyxRejectLeg(env, callControlId);
      return;
    }
  }

  // The session row was created by the RPC (bound to the authorized company/
  // number). Stamp the customer leg's control id for phase-3 hold/transfer.
  const { error } = await db
    .from("calls")
    .update({ customer_call_control_id: callControlId })
    .eq("call_session_id", sessionId);
  if (error) {
    throw new Error(`outbound metadata stamp failed: ${error.message}`);
  }
}

/** How long a minted outbound authorization stays valid (the browser dials
 *  immediately; this is generous headroom for a slow client). */
const OUTBOUND_AUTH_MAX_AGE_SECS = 120;

/** The outbound customer's answer time (ms), from the calls row — the
 *  talk-time billing anchor. Null when never answered / not yet stamped. */
async function outboundAnsweredAtMs(
  db: SupabaseClient,
  sessionId: string | undefined,
): Promise<number | null> {
  if (!sessionId) return null;
  const { data, error } = await db
    .from("calls")
    .select("answered_at")
    .eq("call_session_id", sessionId)
    .limit(1);
  if (error) throw new Error(`answered_at read failed: ${error.message}`);
  const iso = data?.[0]?.answered_at as string | null | undefined;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Hang up a leg we are refusing (dead-leg 4xx tolerated). */
async function telnyxRejectLeg(
  env: Env,
  callControlId: string,
): Promise<void> {
  try {
    await telnyxRequest(env, {
      method: "POST",
      path: `/v2/calls/${callControlId}/actions/hangup`,
      body: {},
    });
  } catch (cause) {
    console.error(
      `outbound leg reject hangup failed for ${callControlId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** D43: stamp the outbound customer answer time (transfer-eligibility +
 *  talk-time billing anchor). Guarded so a replay/duplicate never moves it.
 *  If call.answered arrives BEFORE call.initiated created the row (out-of-order
 *  webhook delivery), throw so the ledger replays this event AFTER the row
 *  exists — otherwise the guarded update no-ops and the call bills zero. */
async function stampOutboundAnswered(
  db: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { data, error } = await db
    .from("calls")
    .update({ answered_at: new Date().toISOString() })
    .eq("call_session_id", sessionId)
    .is("answered_at", null)
    .select("id");
  if (error) {
    throw new Error(`outbound answered stamp failed: ${error.message}`);
  }
  if ((data ?? []).length > 0) return; // freshly stamped

  // 0 rows updated: distinguish already-stamped (row exists) from missing.
  const { data: exists, error: existsError } = await db
    .from("calls")
    .select("id")
    .eq("call_session_id", sessionId)
    .limit(1);
  if (existsError) {
    throw new Error(`outbound answered existence check failed: ${existsError.message}`);
  }
  if ((exists ?? []).length > 0) return; // row exists, answered_at already set — idempotent.

  // The row does NOT exist. Either (a) a genuine out-of-order delivery where
  // initiated will still land, OR (b) an initiated the gate REJECTED (over-cap
  // / dead subscription / unowned number) that will NEVER create a row — the
  // customer answered in the ~300ms reject window. Do NOT throw: throwing
  // would dead-letter case (b) and page Sentry on a call already being torn
  // down (the anti-pattern the inbound over-cap reject already guards). A
  // rejected call must not bill; a genuine out-of-order legit call
  // self-corrects (its far-party hangup finalizes billing conservatively).
  console.warn(
    `outbound answered for ${sessionId} with no calls row (rejected leg or out-of-order) — not stamping`,
  );
}

/**
 * On inbound `call.initiated` (D43 phase 2 — the browser is the phone):
 *
 *   1. Gates, unchanged in spirit: not our number / suspended / non-live
 *      subscription → the call rings out naturally (never answer into dead
 *      air); over the voice spending cap → reject (the untagged hangup still
 *      runs the missed text-back).
 *   2. The session row is created NOW (outcome null = a live call): it
 *      carries the carrier screening verdict, STIR/SHAKEN attestation, and
 *      dipped caller name for honest UI labels, and its presence is the
 *      LINE-BUSY signal — one live call per number, the founder's line model.
 *   3. Routing: line busy → voicemail. Screening 'divert' + flagged caller →
 *      voicemail. Otherwise ring every eligible member's browser
 *      simultaneously; no browsers to ring → voicemail.
 *
 * The inbound leg stays UNANSWERED while browsers ring (real carrier
 * ringback, no billable seconds until a human answers). Cell forwarding is
 * GONE — D43 deleted it; the browser softphone is how calls are taken.
 */
async function handleInboundInitiated(
  env: Env,
  db: SupabaseClient,
  payload: CallPayload,
): Promise<void> {
  // Legs WE placed (member rings, outbound dials, legacy forwards) are
  // 'outgoing' and/or tagged — only the raw customer leg routes here.
  if (
    payload.direction !== "incoming" ||
    classifyLeg(payload) !== "inbound_untagged"
  ) {
    return;
  }

  const callControlId = payload.call_control_id;
  const sessionId = payload.call_session_id;
  const toE164 = payload.to;
  if (!callControlId || !sessionId || !toE164) return;

  // Anonymous/CLIR callers arrive as a NON-E164 marker ('anonymous',
  // 'Restricted', 'unavailable') — normalize to null so it is never dialed
  // as a SIP `from` (Telnyx 422s an invalid from → no browser rings) and
  // never text-backed.
  const callerE164 = normalizeCaller(payload.from);

  const resolved = await resolveNumber(db, toE164);
  if (!resolved) return; // a number we do not own → no-op

  // Replay guard: an `initiated` redelivered AFTER the call already ended
  // (terminal outcome set) must never re-ring the team. The ring-ledger
  // guard alone can't catch a first pass that threw before ledgering.
  const { data: priorRows, error: priorError } = await db
    .from("calls")
    .select("outcome")
    .eq("call_session_id", sessionId)
    .limit(1);
  if (priorError) {
    throw new Error(`initiated replay read failed: ${priorError.message}`);
  }
  if (priorRows?.[0] && (priorRows[0] as { outcome: string | null }).outcome) {
    return;
  }

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select(
      "id,name,plan,current_period_start,overage_cap_multiplier,subscription_status,call_screening,voicemail_greeting",
    )
    .eq("id", resolved.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }
  const company = (companyRows ?? [])[0] as InboundCompany | undefined;
  if (!company) return;

  // #43 suspended-tenant gate: a suspended number (canceled → 30-day grace,
  // D6) or a non-live subscription gets NO ring and NO voicemail — both run
  // billable legs with zero revenue. The call rings out; its untagged hangup
  // flows through handleTerminalCallEvent as a missed call, where the
  // text-back's own claim RPC applies the same subscription gate.
  if (
    resolved.status === "suspended" ||
    company.subscription_status !== "active"
  ) {
    return;
  }

  // D36 voice spending cap: AT the cap (allowance × overage_cap_multiplier)
  // inbound answering pauses entirely — reject; the reject's untagged-leg
  // hangup still runs the missed text-back (idempotent per call). A dead-leg
  // 4xx (caller hung up during the cap RPC; or a replay of an ended call's
  // initiated) is tolerated — the cap condition is durable, so a raw throw
  // here would burn all 5 ledger replays and page Sentry on a state that can
  // never heal.
  if (await companyOverVoiceCap(db, resolved.companyId, company)) {
    try {
      await telnyxRequest(env, {
        method: "POST",
        path: `/v2/calls/${callControlId}/actions/reject`,
        body: { cause: OVER_BUDGET_REJECT_CAUSE },
      });
    } catch (cause) {
      if (!(cause instanceof TelnyxApiError) || cause.status >= 500) throw cause;
    }
    return;
  }

  // Line model (D43, founder-binding): ONE live call per NUMBER, decided
  // ATOMICALLY. api_claim_inbound_line takes a per-(company,number) advisory
  // lock, checks for another in-flight session on the number, and inserts
  // THIS call's row under that same lock — so two calls to one number in the
  // same instant can never both go live (one wins the line, the other is
  // told busy). outcome null on the fresh row marks the line occupied.
  const lineBusy = unwrapBool(
    await db.rpc("api_claim_inbound_line", {
      p_company_id: resolved.companyId,
      p_phone_number_id: resolved.phoneNumberId,
      p_call_session_id: sessionId,
      p_caller_e164: callerE164,
      p_window_start: new Date(Date.now() - LINE_BUSY_WINDOW_MS).toISOString(),
    }),
  );

  // The v2 metadata (screening verdict, attestation, dipped name, the
  // customer leg's control id for phase-3 hold/transfer) rides on the row.
  const { error: metaError } = await db
    .from("calls")
    .update({
      screening_result: payload.call_screening_result ?? null,
      stir_attestation: payload.shaken_stir_attestation ?? null,
      caller_name: payload.caller_id_name ?? null,
      customer_call_control_id: callControlId,
    })
    .eq("call_session_id", sessionId);
  if (metaError) {
    throw new Error(`call metadata stamp failed: ${metaError.message}`);
  }

  if (lineBusy) {
    await startVoicemail(env, {
      callControlId,
      caller: callerE164,
      companyName: company.name,
      greeting: company.voicemail_greeting,
    });
    return;
  }

  // Screening 'divert': a carrier-flagged caller goes straight to voicemail —
  // the team is never interrupted, but a misflagged human still gets to
  // leave a message (and the raw verdict is on the row for honest UI).
  if (
    company.call_screening === "divert" &&
    screeningFlagged(payload.call_screening_result)
  ) {
    await startVoicemail(env, {
      callControlId,
      caller: callerE164,
      companyName: company.name,
      greeting: company.voicemail_greeting,
    });
    return;
  }

  await ringMembersOrVoicemail(env, db, {
    callControlId,
    callSessionId: sessionId,
    callerE164,
    businessNumberE164: toE164,
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    companyName: company.name,
    voicemailGreeting: company.voicemail_greeting,
  });
}

/** A caller number is E.164 or nothing. Telnyx delivers a non-E164 marker
 *  ('anonymous', 'Restricted', 'unavailable') for CLIR/blocked callers —
 *  normalize those to null so they are never dialed or texted. */
export function normalizeCaller(from: string | null | undefined): string | null {
  return from && /^\+[1-9]\d{6,14}$/.test(from) ? from : null;
}

/** Coerce a boolean-returning RPC result (PostgREST may serialize it loosely). */
function unwrapBool(result: { data: unknown; error: unknown }): boolean {
  if (result.error) {
    const e = result.error as { message?: string };
    throw new Error(`rpc failed: ${e.message ?? String(result.error)}`);
  }
  return result.data === true;
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

  // SECURITY (D43): billing + threading for these legs derive the TENANT from
  // browser-echoed data (the client_state tag, or the presented number), so a
  // member could ORIGINATE an OUTGOING WebRTC leg, forge a tag, and present a
  // VICTIM tenant's number to bill/DoS/inject into that victim. The unforgeable
  // proof, for BOTH the inbound-family legs (tenant from payload.TO) AND the
  // tenant-from-`from` legs, is a GENUINE server-created calls row for this
  // session: api_claim_inbound_line (inbound) and api_authorize_outbound_call
  // (outbound customer) each create it at call.initiated, keyed by the
  // AUTHORIZED tenant — a browser-originated forgery is a different session with
  // no such row. forward + out_agent are DEAD (D43 deleted cell forwarding + the
  // bridge) so they never have a row and are always dropped.
  //
  // NOTE: an earlier version gated inbound-family on `direction === 'incoming'`.
  // Telnyx OMITS `direction` on the later events of an ANSWERED leg (the
  // voicemail leg's call.hangup, an answered inbound hangup), so that check
  // silently dropped the hangup that resolves the call → the calls row stayed
  // outcome-null → the line wedged for 4h → every later inbound call skipped the
  // ring and went straight to voicemail. The row check is both correct and
  // strictly stronger (direction is attacker-influenceable / inconsistent;
  // a server-created row is not).
  const inboundFamily =
    leg === "in_browser" ||
    leg === "vm_inbound" ||
    leg === "inbound_untagged" ||
    leg === "inbound_forwarded";
  const tenantFromFrom =
    leg === "forward" || leg === "out_agent" || leg === "out_customer";
  if (inboundFamily || tenantFromFrom) {
    const { data: existing, error: existErr } = await db
      .from("calls")
      .select("id")
      .eq("call_session_id", callId)
      .limit(1);
    if (existErr) {
      throw new Error(`terminal session existence check failed: ${existErr.message}`);
    }
    if ((existing ?? []).length === 0) return; // forged/dead leg — drop
  }

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
  // all routing below. D43: a browser-answered inbound leg ('in_browser')
  // also reads through the 'forward' table (a connected leg's
  // normal_clearing is never a miss); a voicemail-path inbound leg
  // ('vm_inbound') reads as the untagged miss it is — the text-back still
  // fires for a caller who reached voicemail.
  const outcome = computeMissedFromEvent({
    eventType,
    hangupCause: payload.hangup_cause ?? null,
    amdResult: payload.result ?? null,
    leg:
      outboundLeg || leg === "in_browser"
        ? "forward"
        : // 'browser_member'/'transfer_target'/'consult' are routed away
          // before this handler; the mapping only satisfies the pure
          // classifier's narrower leg vocabulary.
          leg === "vm_inbound" ||
            leg === "browser_member" ||
            leg === "transfer_target" ||
            leg === "consult"
          ? "inbound_untagged"
          : leg,
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
    (leg === "forward" ||
      leg === "inbound_untagged" ||
      leg === "out_customer" ||
      // D43: the inbound leg IS the whole call once a browser answered it
      // (or once it entered voicemail — a later recording upgrades the line).
      leg === "in_browser" ||
      leg === "vm_inbound");
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
    } else if (leg === "in_browser") {
      // D43: a browser answered — the inbound leg carries the whole call.
      // Talk time anchors on the bri tag's answer stamp, NEVER the leg's
      // start_time (that includes ring time, which must not count or bill).
      outcome = "answered";
      const answeredAtMs = parseBrowserAnsweredAtMs(payload.client_state);
      const endMs = Date.parse(payload.end_time ?? "");
      if (answeredAtMs !== null && Number.isFinite(endMs)) {
        forwardSeconds = Math.max(0, Math.round((endMs - answeredAtMs) / 1000));
      }
    } else if (leg === "inbound_untagged" || leg === "vm_inbound") {
      // Nobody answered (vm_inbound: ...yet — a saved recording upgrades the
      // session to 'voicemail', which wins the merge in either order).
      outcome = "missed";
    } else if (leg === "out_agent" && input.missed) {
      // D38: the member never picked up their own cell (timeout/decline) —
      // the customer was never dialed. 'missed' = never connected; a
      // normal_clearing agent hangup at the END of a bridged call carries no
      // verdict (the customer leg already decided).
      outcome = "missed";
    }
  } else if (eventType === "call.recording.saved" && leg === "vm_inbound") {
    // D43: a kept voicemail recording IS the session verdict.
    outcome = "voicemail";
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
export async function threadCallSession(
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
    // Every inbound call must reach the inbox: a MISS even with text-back
    // off, a VOICEMAIL (D43: it is OUR voicemail — a first-time caller's
    // message can't live in a conversation that doesn't exist), and an
    // ANSWERED call (D43 phase 3: threading happens at ANSWER time so the
    // member can take notes DURING the call). An outbound call started FROM
    // a conversation, so join-only always finds it.
    p_create_if_missing: input.direction === "inbound",
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
  // D36/D38/D43: the BILLED legs are the far-party legs — 'forward' (legacy
  // cell-forwarded), 'out_customer' (outbound), and 'in_browser' (a
  // browser-answered inbound call, where the inbound leg IS the call). A
  // rang-out far-party leg is a MISS (same pure cause table the text-back
  // path uses) — it must never consume allowance or bill.
  const billedLeg =
    leg === "forward" || leg === "out_customer" || leg === "in_browser";
  const rangOut =
    (leg === "forward" || leg === "out_customer") &&
    computeMissedFromEvent({
      eventType: "call.hangup",
      hangupCause: payload.hangup_cause ?? null,
      amdResult: null,
      leg: "forward",
    }).missed;
  // Talk-time anchoring (never ring time): 'in_browser' rides the bri tag's
  // answer stamp; 'out_customer' rides calls.answered_at (stamped when the
  // customer picked up). A missing anchor bills ZERO (fail toward the
  // customer — a call that never proved it connected never bills).
  let seconds = rangOut ? 0 : windowSeconds;
  if (leg === "in_browser") {
    const answeredAtMs = parseBrowserAnsweredAtMs(payload.client_state);
    seconds =
      answeredAtMs === null
        ? 0
        : Math.max(0, Math.round((endMs - answeredAtMs) / 1000));
  } else if (leg === "out_customer" && !rangOut) {
    const answeredAtMs = await outboundAnsweredAtMs(
      db,
      payload.call_session_id,
    );
    seconds =
      answeredAtMs === null
        ? 0
        : Math.max(0, Math.round((endMs - answeredAtMs) / 1000));
  }
  // Defense-in-depth clamp: a talk-time anchor that came from a client_state
  // timestamp (in_browser's bri tag) must never produce an absurd billable
  // duration even if it somehow reached here with a forged anchor. No genuine
  // call exceeds the 2h runaway-hangup cap, so the ceiling never touches real
  // billing — it only neutralises a garbage/attacker anchor.
  seconds = Math.min(seconds, MAX_BILLABLE_SECONDS);
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
          leg === "forward" ||
          leg === "out_agent" ||
          leg === "out_customer" ||
          leg === "in_browser"
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
