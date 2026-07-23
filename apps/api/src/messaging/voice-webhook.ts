/**
 * Call-Control webhook glue for the calls-v3 world. Every inbound and outbound
 * CALL is a CallSessionDO session (calls/session-do.ts); this module is NOT the
 * call dispatcher. It provides two things:
 *
 *   1. handleCallEvent — the webhook entry (dispatched from /webhooks/telnyx)
 *      for the events that are NOT full DO sessions: the consult/transfer
 *      (brc/brt) legs, which attach to a live DO session and run the D43
 *      live-call handlers (messaging/live-call.ts).
 *   2. The SHARED delegates the DO invokes through runtime.ts: the terminal
 *      merge (handleTerminalCallEvent), the voicemail pipeline
 *      (handleVoicemailSaved), threading (threadCallSession), the voice
 *      metering (recordCallDuration), and the outbound tag helpers
 *      (buildOutboundState / parseOutboundNonce / parseOutboundSessionId).
 *
 * Leg classification (classifyLeg) reads the echoed client_state tag. The D38
 * cell-bridge tags ('oc_agent', 'mctb_forward', 'mctb_inbound_fwd') remain
 * classifiable but INERT — nothing creates them (cell forwarding + the D38
 * bridge were deleted at D43).
 *
 * "Missed" is COMPUTED per {@link computeMissedFromEvent} — never a bare hangup
 * on an answered call. Idempotency is per call_session_id at the claim RPC, so
 * a retried webhook never double-texts.
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
import { telnyxRequest } from "../telnyx/client";
import {
  BROWSER_INBOUND_STATE,
  BROWSER_MEMBER_STATE,
  VOICEMAIL_INBOUND_STATE,
  deleteTelnyxRecording,
  insertVoicemailEvent,
  parseBrowserAnsweredAtMs,
  recoverStoredVoicemail,
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
  // #144: seconds to RESERVE on top of terminated usage for calls that are
  // already live but not yet billed (they bill only on hangup). The outbound
  // starter passes a per-live-call estimate so a tenant sitting AT the cap
  // can't fan out several concurrent new calls that each pass the same
  // pre-answer boundary and collectively overshoot. 0 (the default, used by the
  // inbound path) preserves the exact terminated-usage boundary.
  reserveSeconds = 0,
): Promise<boolean> {
  if (!company.plan || !company.current_period_start) return false;
  const { data, error } = await db.rpc("api_period_forward_seconds", {
    p_company_id: companyId,
    p_since: company.current_period_start,
  });
  if (error) {
    throw new Error(`voice usage lookup failed: ${error.message}`);
  }
  const usedSeconds = Number(data) + reserveSeconds;
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

/** Build the 4-part tagged client_state for a browser-originated outbound leg:
 *  `oc_customer|<customer>|<nonce>|<S>`. The nonce is the single-use
 *  authorization POST /v1/calls/browser minted (the webhook consumes it to
 *  authorize the call — D43 cross-tenant/forgery fix); S is the #211 server
 *  session id, the ONE id the DO idFromName, the calls-row PK, and the client
 *  all key on. Both are always present — v3 is the sole path, so there is no
 *  shorter tag. */
export function buildOutboundState(
  tag: typeof OUTBOUND_AGENT_STATE | typeof OUTBOUND_CUSTOMER_STATE,
  customerE164: string,
  nonce: string,
  sessionId: string,
): string {
  return btoa(`${tag}|${customerE164}|${nonce}|${sessionId}`);
}

/** The authorization nonce a browser-originated oc_customer leg carries
 *  (part-3 of `oc_customer|<customer>|<nonce>|<S>`), or null when absent (a
 *  forged/omitted tag — loadOutboundInitiatedContext then rejects the leg).
 *  Exported for the #211 DO path (runtime.loadOutboundInitiatedContext). */
export function parseOutboundNonce(raw: string | null | undefined): string | null {
  const decoded = decodeClientState(raw ?? null);
  if (!decoded) return null;
  const parts = decoded.split("|");
  return parts[0] === OUTBOUND_CUSTOMER_STATE && parts[2] ? parts[2] : null;
}

/** Canonical UUID shape — the #211 server session id S is a randomUUID(); a
 *  4-part oc tag whose part-4 is not a well-formed UUID is treated as no S at
 *  all (never keyed on, never idFromName'd). */
const OUTBOUND_SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #211: the server session id S a browser-originated oc_customer leg carries
 * (`oc_customer|<customer>|<nonce>|<S>`), IFF part-4 is a well-formed UUID; null
 * for a non-oc tag or a malformed/absent part-4.
 *
 * This is the ONE id the DO idFromName, the calls-row PK, and the client all key
 * on. It is AUTHORITATIVE for routing (the webhook-router routes an oc leg to the
 * DO keyed on it), and the shared terminal-merge reads it (via runtime.ts) so the
 * S-row is billed and client-addressable under the SAME id everywhere.
 */
export function parseOutboundSessionId(
  raw: string | null | undefined,
): string | null {
  const decoded = decodeClientState(raw ?? null);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== OUTBOUND_CUSTOMER_STATE) return null;
  const s = parts[3];
  return s && OUTBOUND_SESSION_UUID_RE.test(s) ? s : null;
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

  const leg = classifyLeg(payload);

  // D43 phase 3: transfer target legs (brt) — answer stamps the new owner +
  // journey line; a MISSED transfer auto-recovers (snap back to the sender,
  // voicemail at the hop cap). These legs never bill or thread themselves.
  if (leg === "transfer_target") {
    const state = parseTransferState(payload.client_state);
    if (!state) return;
    if (eventType === "call.answered") {
      return handleTransferAnswered(env, db, state, payload.call_control_id);
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

  // D43 phase 3: consult legs (brc — the member-to-member announce call).
  // Answer marks the ledger and bridges when both sides are up; hangup
  // dismisses the sibling. Never bills, never threads.
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

  // Outbound-leg authorization gate (the D43 nonce gate's PSTN enforcement).
  // A VALID 4-part oc customer leg routes to the CallSessionDO (which
  // authorizes it via loadOutboundInitiatedContext and rejects a bad nonce),
  // so it never reaches here. An outgoing call.initiated that DOES reach here
  // is therefore either one of OUR own server-issued legs (member ring /
  // consult / transfer — always dialed to a Telnyx CREDENTIAL URI, never a
  // phone number) or a browser-originated PSTN leg whose client_state was NOT
  // minted by POST /v1/calls/browser. The softphone controls its own tag, so
  // the gate trusts the DIAL TARGET, not the tag: a credential URI is ours and
  // is allowed; anything outgoing to a PSTN number bypassed the
  // cap / subscription / number-ownership / NANP gate and MUST be hung up, or a
  // member with a WebRTC credential could place uncapped, cross-tenant
  // caller-ID, non-NANP calls by crafting client_state.
  if (eventType === "call.initiated" && payload.direction === "outgoing") {
    const to = payload.to ?? "";
    const isCredentialUri =
      to.startsWith("sip:") &&
      to.includes("@sip.telnyx.com") &&
      !/^sip:\+?\d/.test(to);
    if (!isCredentialUri && payload.call_control_id) {
      await telnyxRejectLeg(env, payload.call_control_id);
    }
    return;
  }

  // The shared terminal merge (billing, outcome, threading, text-back). Every
  // inbound and outbound CALL is a CallSessionDO session, and the DO invokes
  // this delegate itself (runtime.terminalMergeEvent); a call terminal reaches
  // HERE only for a non-session-family leg — the inert D38 cell-bridge legs
  // (forward / oc_agent), which nothing creates. The forgery gate inside
  // requires a genuine server-created calls row, so a stray leg is dropped.
  if (
    eventType === "call.hangup" ||
    eventType === "call.machine.detection.ended"
  ) {
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
export async function handleVoicemailSaved(
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

/** How long a minted outbound authorization stays valid (the browser dials
 *  immediately; this is generous headroom for a slow client). Exported for the
 *  #211 DO path (runtime.loadOutboundInitiatedContext), which consumes the same
 *  nonce with the same freshness bound. */
export const OUTBOUND_AUTH_MAX_AGE_SECS = 120;

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

/** A caller number is E.164 or nothing. Telnyx delivers a non-E164 marker
 *  ('anonymous', 'Restricted', 'unavailable') for CLIR/blocked callers —
 *  normalize those to null so they are never dialed or texted. */
export function normalizeCaller(from: string | null | undefined): string | null {
  return from && /^\+[1-9]\d{6,14}$/.test(from) ? from : null;
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
export async function handleTerminalCallEvent(
  env: Env,
  db: SupabaseClient,
  eventType: string,
  payload: CallPayload,
  // #211 M1: for an outbound (oc) leg the calls row is keyed on S (== tag
  // part-4), NOT Telnyx's call_session_id. The DO's terminal-merge (the only
  // outbound caller) passes S as outboundSessionId AND the DO-authoritative
  // answered-at anchor. Inbound passes no opts and falls through to
  // call_session_id (inbound's S IS Telnyx's id). The middle parseOutbound read
  // is defense in depth for a stray 4-part tag arriving without opts.
  opts?: { outboundSessionId?: string; outboundAnsweredAtIso?: string | null },
): Promise<void> {
  const callId =
    opts?.outboundSessionId ??
    parseOutboundSessionId(payload.client_state) ??
    payload.call_session_id;
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
    // #211 M1: pass S (callId) so the out_customer answered_at read + the
    // call_records.call_session_id key on the S-row, and the DO-authoritative
    // answered-at override so talk time bills even if the mirror never landed.
    await recordCallDuration(
      env,
      db,
      payload,
      leg,
      ourNumberE164,
      callId,
      opts?.outboundAnsweredAtIso,
    );
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
      // D38 (inert — nothing creates oc_agent legs anymore): the member's own
      // voicemail answered the agent leg, so the customer was never dialed.
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
  // #211: the session id the calls row + call_records are keyed on. For an
  // outbound (oc) leg this is S (== tag part-4), NOT Telnyx's call_session_id;
  // for inbound it IS payload.call_session_id (byte-identical to today).
  sessionId: string,
  // #211 M1: the DO-authoritative outbound answered-at (machine.answeredAtIso).
  // PREFERRED over the calls.answered_at row read, so out_customer bills talk
  // time even if the answered_at mirror never landed.
  outboundAnsweredAtIso?: string | null,
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
    // #211 M1: PREFER the DO-authoritative answered-at override (machine.
    // answeredAtIso — mirror-independent) over the calls.answered_at row read;
    // both anchor talk time on the customer's pickup, never ring time. Read by
    // S (sessionId). A missing anchor bills ZERO (a call that never proved it
    // connected never bills).
    let answeredAtMs: number | null = null;
    if (outboundAnsweredAtIso) {
      const overrideMs = Date.parse(outboundAnsweredAtIso);
      if (Number.isFinite(overrideMs)) answeredAtMs = overrideMs;
    }
    if (answeredAtMs === null) {
      answeredAtMs = await outboundAnsweredAtMs(db, sessionId);
    }
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
        // #211: key the billing record on S (== tag part-4) for outbound; for
        // inbound sessionId IS payload.call_session_id, so byte-identical.
        call_session_id: sessionId,
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
