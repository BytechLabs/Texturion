/**
 * #135 (D43) phase 3: live-call handling — transfer (blind + announce) under
 * the founder-binding line model: one live call per number, NO Telnyx
 * conferences ever. Every construct here is a two-party bridge or a parked
 * leg. Hold is client-side (the @telnyx/webrtc call.hold() — the customer
 * stays connected, so billing stays honest); this module owns what the
 * SERVER must do:
 *
 *   BLIND TRANSFER — the Telnyx `transfer` command on the CUSTOMER leg dials
 *   the target member's credential (`brt` tag) and bridges on answer; the
 *   sender's own leg is unbridged by Telnyx and their client hangs it up.
 *   client_state is deliberately NOT sent with the command, so the customer
 *   leg keeps its `bri` billing anchor. Decline/timeout auto-recovers: the
 *   customer snaps BACK to the sender (hop 1); a second failure — the hop
 *   cap — diverts to voicemail. The caller is never stranded in silence.
 *
 *   ANNOUNCE (CONSULT) TRANSFER — the consult is its OWN two-party call
 *   between the two members (both legs dialed by us on the Call-Control app,
 *   `brc` tags, ledgered as kind='consult'); the customer stays where they
 *   are (client-held by the sender). Completing the transfer bridge-STEALS
 *   the customer leg onto the target's consult leg and hangs up the
 *   sender's; cancelling hangs up both consult legs.
 *
 * Journey honesty: every answered transfer stamps calls.answered_by_user_id
 * and drops a timeline line on the conversation, so the thread reads
 * "answered by A · transferred to B".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";
import { startVoicemail } from "./inbound-ring";

/** Transfer target leg: `brt|<session>|<targetUser>|<senderUser>|<hops>|<caller-or-empty>` */
export const TRANSFER_TARGET_STATE = "brt";

/** Consult call legs: `brc|<session>|<user>|<role s|t>` (s=sender, t=target). */
export const CONSULT_LEG_STATE = "brc";

/** Ring window for transfer/consult legs (the member is at a screen). */
export const TRANSFER_TIMEOUT_SECS = 25;

/** One snap-back, then voicemail — never an infinite transfer ping-pong. */
const MAX_TRANSFER_HOPS = 1;

function b64encode(value: string): string {
  return btoa(value);
}

function b64decode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return atob(raw);
  } catch {
    return null;
  }
}

export function buildTransferState(input: {
  sessionId: string;
  targetUserId: string;
  senderUserId: string;
  hops: number;
  caller: string | null;
}): string {
  return b64encode(
    `${TRANSFER_TARGET_STATE}|${input.sessionId}|${input.targetUserId}|${input.senderUserId}|${input.hops}|${input.caller ?? ""}`,
  );
}

export interface TransferState {
  sessionId: string;
  targetUserId: string;
  senderUserId: string;
  hops: number;
  caller: string | null;
}

export function parseTransferState(
  raw: string | null | undefined,
): TransferState | null {
  const decoded = b64decode(raw);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== TRANSFER_TARGET_STATE || parts.length < 6) return null;
  const [, sessionId, targetUserId, senderUserId, hopsRaw, caller] = parts;
  const hops = Number(hopsRaw);
  if (!sessionId || !targetUserId || !senderUserId || !Number.isFinite(hops)) {
    return null;
  }
  return { sessionId, targetUserId, senderUserId, hops, caller: caller || null };
}

export function buildConsultState(input: {
  sessionId: string;
  userId: string;
  role: "s" | "t";
}): string {
  return b64encode(
    `${CONSULT_LEG_STATE}|${input.sessionId}|${input.userId}|${input.role}`,
  );
}

export interface ConsultState {
  sessionId: string;
  userId: string;
  role: "s" | "t";
}

export function parseConsultState(
  raw: string | null | undefined,
): ConsultState | null {
  const decoded = b64decode(raw);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== CONSULT_LEG_STATE || parts.length < 4) return null;
  const [, sessionId, userId, role] = parts;
  if (!sessionId || !userId || (role !== "s" && role !== "t")) return null;
  return { sessionId, userId, role };
}

/** Commands on legs that may already be dead 4xx — that's telephony, not a
 *  fault. Real (5xx/network) failures rethrow into the webhook ledger. */
async function telnyxOnLiveLeg(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    await telnyxRequest(env, { method: "POST", path, body });
    return true;
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) return false;
    throw cause;
  }
}

/** The live-call slice of the calls row every handler here needs. */
export interface LiveCallRow {
  company_id: string;
  phone_number_id: string | null;
  conversation_id: string | null;
  caller_e164: string | null;
  customer_call_control_id: string | null;
  answered_at: string | null;
  outcome: string | null;
}

export async function liveCallBySession(
  db: SupabaseClient,
  sessionId: string,
): Promise<LiveCallRow | null> {
  const { data, error } = await db
    .from("calls")
    .select(
      "company_id,phone_number_id,conversation_id,caller_e164,customer_call_control_id,answered_at,outcome",
    )
    .eq("call_session_id", sessionId)
    .limit(1);
  if (error) throw new Error(`calls read failed: ${error.message}`);
  return (data?.[0] as LiveCallRow | undefined) ?? null;
}

/** Issue the blind transfer on the customer leg. `client_state` is NOT sent —
 *  the customer leg must keep its `bri` billing anchor. */
export async function issueTransfer(
  env: Env,
  input: {
    customerCcid: string;
    targetSipUsername: string;
    businessNumberE164: string;
    state: TransferState;
  },
): Promise<boolean> {
  return telnyxOnLiveLeg(
    env,
    `/v2/calls/${input.customerCcid}/actions/transfer`,
    {
      to: `sip:${input.targetSipUsername}@sip.telnyx.com`,
      from: input.businessNumberE164,
      timeout_secs: TRANSFER_TIMEOUT_SECS,
      target_leg_client_state: buildTransferState(input.state),
    },
  );
}

/**
 * A transfer target answered: the customer is now theirs. Stamp the
 * read-model and drop the journey line. (Telnyx bridged the legs itself —
 * that is the transfer command's contract.)
 */
export async function handleTransferAnswered(
  db: SupabaseClient,
  state: TransferState,
): Promise<void> {
  const { error } = await db
    .from("calls")
    .update({ answered_by_user_id: state.targetUserId })
    .eq("call_session_id", state.sessionId);
  if (error) throw new Error(`transfer stamp failed: ${error.message}`);

  const call = await liveCallBySession(db, state.sessionId);
  if (!call?.conversation_id) return; // unthreaded (anonymous) — list-only
  await insertJourneyEvent(db, {
    companyId: call.company_id,
    conversationId: call.conversation_id,
    callSessionId: state.sessionId,
    kind: "transferred",
    fromUserId: state.senderUserId,
    toUserId: state.targetUserId,
  });
}

/**
 * A transfer target leg ended. A normal end-of-call hangup (the call was
 * answered and later finished) carries no verdict — the customer leg's own
 * terminal event owns the outcome. A MISSED transfer (timeout / decline /
 * busy) auto-recovers: hop 0 snaps the customer back to the sender; at the
 * hop cap the customer goes to voicemail — never stranded in silence.
 */
export async function handleTransferLegHangup(
  env: Env,
  db: SupabaseClient,
  state: TransferState,
  missed: boolean,
): Promise<void> {
  if (!missed) return;

  const call = await liveCallBySession(db, state.sessionId);
  if (!call?.customer_call_control_id) return;
  if (call.outcome !== null) return; // the call already ended — nothing to save

  if (state.hops < MAX_TRANSFER_HOPS) {
    // Snap back to the sender.
    const { data, error } = await db
      .from("member_telephony_credentials")
      .select("sip_username")
      .eq("company_id", call.company_id)
      .eq("user_id", state.senderUserId)
      .limit(1);
    if (error) throw new Error(`credential read failed: ${error.message}`);
    const sip = data?.[0]?.sip_username as string | undefined;
    if (sip) {
      const issued = await issueTransfer(env, {
        customerCcid: call.customer_call_control_id,
        targetSipUsername: sip,
        businessNumberE164: await businessNumberFor(db, call),
        state: {
          sessionId: state.sessionId,
          targetUserId: state.senderUserId,
          senderUserId: state.senderUserId,
          hops: state.hops + 1,
          caller: state.caller,
        },
      });
      if (issued) return;
    }
  }

  await voicemailForLiveCall(env, db, call, state.caller);
}

/** The business number a live call rides on (present it on new legs). */
async function businessNumberFor(
  db: SupabaseClient,
  call: LiveCallRow,
): Promise<string> {
  if (!call.phone_number_id) throw new Error("live call has no number");
  const { data, error } = await db
    .from("phone_numbers")
    .select("number_e164")
    .eq("id", call.phone_number_id)
    .limit(1);
  if (error) throw new Error(`number read failed: ${error.message}`);
  const number = data?.[0]?.number_e164 as string | undefined;
  if (!number) throw new Error("live call number missing");
  return number;
}

/** Fetch greeting + name and put the customer into voicemail. */
async function voicemailForLiveCall(
  env: Env,
  db: SupabaseClient,
  call: LiveCallRow,
  caller: string | null,
): Promise<void> {
  const { data, error } = await db
    .from("companies")
    .select("name,voicemail_greeting")
    .eq("id", call.company_id)
    .limit(1);
  if (error) throw new Error(`company read failed: ${error.message}`);
  const company = data?.[0] as
    | { name: string; voicemail_greeting: string | null }
    | undefined;
  if (!company || !call.customer_call_control_id) return;
  await startVoicemail(env, {
    callControlId: call.customer_call_control_id,
    caller: caller ?? call.caller_e164,
    companyName: company.name,
    greeting: company.voicemail_greeting,
  });
}

/**
 * Consult-call leg events. Answer marks the ledger row; when BOTH consult
 * legs are answered, bridge them (the member↔member conversation). A consult
 * leg hanging up dismisses its sibling — a half-dead consult must never
 * leave one member listening to silence.
 */
export async function handleConsultLegEvent(
  env: Env,
  db: SupabaseClient,
  eventType: string,
  ccid: string,
  state: ConsultState,
): Promise<void> {
  if (eventType === "call.answered") {
    const { error } = await db
      .from("call_member_legs")
      .update({ state: "answered" })
      .eq("call_session_id", state.sessionId)
      .eq("call_control_id", ccid)
      .eq("kind", "consult");
    if (error) throw new Error(`consult stamp failed: ${error.message}`);

    // Both sides up → bridge them.
    const legs = await consultLegs(db, state.sessionId);
    const answered = legs.filter((leg) => leg.state === "answered");
    if (answered.length >= 2) {
      await telnyxOnLiveLeg(env, `/v2/calls/${ccid}/actions/bridge`, {
        call_control_id:
          answered.find((leg) => leg.call_control_id !== ccid)
            ?.call_control_id ?? "",
      });
    }
    return;
  }

  if (eventType === "call.hangup") {
    const { error } = await db
      .from("call_member_legs")
      .update({ state: "failed" })
      .eq("call_session_id", state.sessionId)
      .eq("call_control_id", ccid)
      .eq("kind", "consult");
    if (error) throw new Error(`consult hangup stamp failed: ${error.message}`);
    // Dismiss the sibling (idempotent; dead legs 4xx and are swallowed).
    const legs = await consultLegs(db, state.sessionId);
    for (const leg of legs) {
      if (leg.call_control_id === ccid) continue;
      if (leg.state === "failed") continue;
      await telnyxOnLiveLeg(
        env,
        `/v2/calls/${leg.call_control_id}/actions/hangup`,
        {},
      );
    }
  }
}

export interface ConsultLegRow {
  call_control_id: string;
  user_id: string;
  state: string;
}

export async function consultLegs(
  db: SupabaseClient,
  sessionId: string,
): Promise<ConsultLegRow[]> {
  const { data, error } = await db
    .from("call_member_legs")
    .select("call_control_id,user_id,state")
    .eq("call_session_id", sessionId)
    .eq("kind", "consult");
  if (error) throw new Error(`consult legs read failed: ${error.message}`);
  return (data ?? []) as ConsultLegRow[];
}

/** The journey timeline line (dedupe-scanned per (session, kind, to)). */
export async function insertJourneyEvent(
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    callSessionId: string;
    kind: "transferred";
    fromUserId: string;
    toUserId: string;
  },
): Promise<void> {
  const { data: existing, error: scanError } = await db
    .from("conversation_events")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("type", "call_completed")
    .eq("payload->>call_session_id", input.callSessionId)
    .eq("payload->>kind", input.kind)
    .eq("payload->>to_user_id", input.toUserId)
    .limit(1);
  if (scanError) {
    throw new Error(`journey event scan failed: ${scanError.message}`);
  }
  if ((existing ?? []).length > 0) return;

  const { error } = await db.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    actor_user_id: null,
    type: "call_completed",
    payload: {
      kind: input.kind,
      call_session_id: input.callSessionId,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
    },
  });
  if (error) throw new Error(`journey event insert failed: ${error.message}`);
}
