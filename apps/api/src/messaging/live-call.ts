/**
 * #135 (D43) phase 3: live-call handling — transfer (blind + announce) under
 * the founder-binding line model: one live call per number, NO Telnyx
 * conferences ever. Every construct here is a two-party bridge or a parked
 * leg. Hold is client-side (the @telnyx/webrtc call.hold() — the customer
 * stays connected, so billing stays honest); this module owns what the
 * SERVER must do:
 *
 *   BLIND TRANSFER: a separate target leg rings while the customer stays
 *   with the sender. On answer the session switches the bridge without
 *   rewriting the customer's billing anchor.
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

import type { CallSessionDO } from "../calls/session-do";
import type { Env } from "../env";
import { isDefiniteRefusal, telnyxRequest } from "../telnyx/client";
import { hangupLiveLeg, LOONEXT_SESSION_HEADER } from "./inbound-ring";

/** Transfer target leg: `brt|<session>|<target>|<sender>|<hops>|<caller-or-empty>[|<transferId>]` */
export const TRANSFER_TARGET_STATE = "brt";

/** Consult call legs: `brc|<session>|<user>|<role s|t>` (s=sender, t=target). */
export const CONSULT_LEG_STATE = "brc";

/** Ring window for transfer and consult legs. */
export const TRANSFER_TIMEOUT_SECS = 25;

/** One snap-back, then voicemail — never an infinite transfer ping-pong. */
const MAX_TRANSFER_HOPS = 1;
const TRANSFER_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

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

export interface TransferState {
  sessionId: string;
  targetUserId: string;
  senderUserId: string;
  hops: number;
  caller: string | null;
  transferId?: string;
  wakeId?: string;
}

export function buildTransferState(input: TransferState): string {
  const id = input.transferId ? `|${input.transferId}` : "";
  const wake = input.transferId && input.wakeId ? `|${input.wakeId}` : "";
  return b64encode(
    `${TRANSFER_TARGET_STATE}|${input.sessionId}|${input.targetUserId}|${input.senderUserId}|${input.hops}|${input.caller ?? ""}${id}${wake}`,
  );
}

export function parseTransferState(
  raw: string | null | undefined,
): TransferState | null {
  const decoded = b64decode(raw);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== TRANSFER_TARGET_STATE || parts.length < 6 || parts.length > 8) return null;
  const [, sessionId, targetUserId, senderUserId, hopsRaw, caller, transferId, wakeId] = parts;
  const hops = Number(hopsRaw);
  if (!sessionId || !targetUserId || !senderUserId || !Number.isFinite(hops)) {
    return null;
  }
  if (transferId !== undefined && !TRANSFER_ID.test(transferId)) return null;
  if (wakeId !== undefined && !TRANSFER_ID.test(wakeId)) return null;
  return { sessionId, targetUserId, senderUserId, hops, caller: caller || null, transferId, wakeId };
}

function transferLegToken(state: TransferState): string {
  const id = state.transferId ?? `${state.targetUserId}:${state.hops}`;
  return state.wakeId ? `transfer:${id}:${state.wakeId}` : `transfer:${id}`;
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
  } catch (error) {
    if (isDefiniteRefusal(error)) return false;
    throw error;
  }
}

/** The CallSessionDO stub for a session, or null when the binding is absent.
 *  Mirrors routes/live-calls.ts: the webhook side needs the same #170 §7.4
 *  owner/intent RPCs (the transfer answer is an owner hand-off too). */
function callSessionStub(env: Env, sessionId: string): CallSessionDO | null {
  const namespace = env.CALL_SESSIONS;
  if (!namespace) return null;
  return namespace.get(
    namespace.idFromName(sessionId),
  ) as unknown as CallSessionDO;
}

export async function bindRegisteredTransferLeg(env: Env, state: TransferState, memberCcid: string): Promise<void> {
  if (!state.transferId) return;
  const stub = callSessionStub(env, state.sessionId);
  if (!stub) throw new Error("registered transfer has no session binding");
  await stub.bindTransferLeg({
    transferId: state.transferId, wakeId: state.wakeId, targetUserId: state.targetUserId, memberCcid,
  });
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
  /** 'inbound' | 'outbound' — ring-me (#139) is inbound-only. */
  direction: string | null;
}

export async function liveCallBySession(
  db: SupabaseClient,
  sessionId: string,
): Promise<LiveCallRow | null> {
  const { data, error } = await db
    .from("calls")
    .select(
      "company_id,phone_number_id,conversation_id,caller_e164,customer_call_control_id,answered_at,outcome,direction",
    )
    .eq("call_session_id", sessionId)
    .limit(1);
  if (error) throw new Error(`calls read failed: ${error.message}`);
  return (data?.[0]) ?? null;
}

/**
 * LEDGER a transfer intent, then issue the blind transfer. The ledger row
 * (kind='transfer') is the proof handleTransferAnswered checks before it trusts
 * the echoed `brt` tag — without it, a member could forge a brt client_state on
 * their own softphone call and rewrite the 'who answered' audit field /
 * fabricate a journey line on any session. The target sees the CUSTOMER as
 * caller ID (who they are about to talk to), not the workspace's own number.
 *
 * Registered transfers dial the target independently and switch the bridge
 * on answer. Recovery for an in-flight legacy inbound transfer still uses
 * Telnyx's transfer command because the sender has already been unbridged.
 */
export async function issueTransfer(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    customerCcid: string;
    targetSipUsername: string;
    callerNumberForTarget: string;
    state: TransferState;
    /** Legacy sessions keep their original transfer behavior. */
    direction: "inbound" | "outbound";
  },
): Promise<boolean> {
  const legToken = transferLegToken(input.state);
  const { error: ledgerError } = await db.from("call_member_legs").upsert(
    {
      call_session_id: input.state.sessionId,
      call_control_id: legToken,
      company_id: input.companyId,
      user_id: input.state.targetUserId,
      kind: "transfer",
      state: "ringing",
    },
    { onConflict: "call_session_id,call_control_id" },
  );
  if (ledgerError) {
    throw new Error(`transfer ledger insert failed: ${ledgerError.message}`);
  }

  // CALLS-CLIENT-V2 §3.2 (#208): the transfer's NEW member (brt) leg carries the
  // same session-correlation custom SIP header as ring legs (X- prefix
  // mandatory), so the target's client correlates the INVITE to its server
  // session deterministically, never by a caller/time heuristic.
  const targetHeaders = [
    { name: LOONEXT_SESSION_HEADER, value: input.state.sessionId },
  ];

  if (input.state.transferId || input.direction === "outbound") {
    const dialed = await telnyxOnLiveLeg(env, "/v2/calls", {
      connection_id: env.TELNYX_VOICE_CONNECTION_ID,
      to: `sip:${input.targetSipUsername}@sip.telnyx.com`,
      // The target sees who they're about to talk to (the customer), not our own
      // number (falls back to the business number for an anonymous caller).
      from: input.callerNumberForTarget,
      timeout_secs: TRANSFER_TIMEOUT_SECS,
      client_state: buildTransferState(input.state),
      ...(input.state.transferId ? { command_id: input.state.wakeId ?? input.state.transferId } : {}),
      custom_headers: targetHeaders,
    });
    if (!dialed) {
      await db
        .from("call_member_legs")
        .delete()
        .eq("call_session_id", input.state.sessionId)
        .eq("call_control_id", legToken);
    }
    return dialed;
  }

  const issued = await telnyxOnLiveLeg(
    env,
    `/v2/calls/${input.customerCcid}/actions/transfer`,
    {
      to: `sip:${input.targetSipUsername}@sip.telnyx.com`,
      // The target member sees who they're getting (falls back to the
      // business number only for an anonymous caller).
      from: input.callerNumberForTarget,
      timeout_secs: TRANSFER_TIMEOUT_SECS,
      target_leg_client_state: buildTransferState(input.state),
      // Applies to the target leg only; the customer leg is untouched (its bri
      // anchor stays).
      custom_headers: targetHeaders,
    },
  );
  if (!issued) {
    // The customer leg died before we could transfer — drop the intent.
    await db
      .from("call_member_legs")
      .delete()
      .eq("call_session_id", input.state.sessionId)
      .eq("call_control_id", legToken);
  }
  return issued;
}

async function handleRegisteredTransferAnswer(
  env: Env,
  db: SupabaseClient,
  state: TransferState,
  transferId: string,
  realLegCcid: string,
): Promise<void> {
  const token = transferLegToken(state);
  const { data: pending, error: pendingError } = await db.from("call_member_legs")
    .select("company_id").eq("call_session_id", state.sessionId).eq("call_control_id", token)
    .eq("user_id", state.targetUserId).eq("kind", "transfer").eq("state", "ringing").limit(1);
  if (pendingError) throw new Error(`transfer lookup failed: ${pendingError.message}`);
  const companyId = pending?.[0]?.company_id;
  if (!companyId) return;

  const stub = callSessionStub(env, state.sessionId);
  if (!stub) throw new Error("registered transfer has no session binding");
  const bridged = await stub.completeTransfer({
    transferId, wakeId: state.wakeId, targetUserId: state.targetUserId, memberCcid: realLegCcid,
  });
  if (bridged) {
    const call = await liveCallBySession(db, state.sessionId);
    if (call?.conversation_id) {
      await insertJourneyEvent(db, {
        companyId,
        conversationId: call.conversation_id,
        callSessionId: state.sessionId,
        kind: "transferred",
        fromUserId: state.senderUserId,
        toUserId: state.targetUserId,
      });
    }
  } else {
    await hangupLiveLeg(env, realLegCcid);
  }

  const { error } = await db.from("call_member_legs")
    .update({
      state: bridged ? "answered" : "failed",
      call_control_id: bridged ? realLegCcid : token,
    })
    .eq("company_id", companyId).eq("call_session_id", state.sessionId)
    .eq("call_control_id", token).eq("state", "ringing");
  if (error) throw new Error(`transfer settle failed: ${error.message}`);
}

/**
 * A transfer target answered: the customer is now theirs. VERIFY the transfer
 * was actually issued (a ledgered kind='transfer' intent for this session +
 * target) before trusting the echoed tag — a forged brt with no ledger row is
 * ignored. The ledger transition 'ringing'→'answered' also makes a webhook
 * REPLAY idempotent (the second pass matches zero rows) and stops a stale
 * earlier-transfer replay from overwriting the current owner. Company scope
 * comes from the trusted ledger row, never the client tag.
 */
export async function handleTransferAnswered(
  env: Env,
  db: SupabaseClient,
  state: TransferState,
  realLegCcid: string | undefined,
): Promise<void> {
  if (state.transferId) {
    if (realLegCcid) {
      await handleRegisteredTransferAnswer(env, db, state, state.transferId, realLegCcid);
    }
    return;
  }
  // Claim the ledgered intent AND stamp the real leg ccid onto it (the ledger
  // row was inserted with a synthetic `transfer:<user>:<hops>` token — the
  // real ccid is only known now). The by-leg resolver then finds this row by
  // the target browser's leg ccid, so the transferee can drive live-call ops.
  const { data: claimed, error: claimError } = await db
    .from("call_member_legs")
    .update(
      realLegCcid
        ? { state: "answered", call_control_id: realLegCcid }
        : { state: "answered" },
    )
    .eq("call_session_id", state.sessionId)
    .eq("call_control_id", transferLegToken(state))
    .eq("user_id", state.targetUserId)
    .eq("kind", "transfer")
    .eq("state", "ringing")
    .select("company_id");
  if (claimError) {
    throw new Error(`transfer claim failed: ${claimError.message}`);
  }
  const companyId = claimed?.[0]?.company_id as string | undefined;
  if (!companyId) return; // no issued transfer (forged tag or replay) — ignore

  const { error } = await db
    .from("calls")
    .update({ answered_by_user_id: state.targetUserId })
    .eq("call_session_id", state.sessionId)
    .eq("company_id", companyId);
  if (error) throw new Error(`transfer stamp failed: ${error.message}`);

  // #208 (#170 §7.4): hand the MACHINE's owner to the target, THEN clear the
  // transfer intent. THE ORDER IS LOAD-BEARING: set-owner clears the reducer's
  // ownerLegDeadDuringIntent flag (transitions.ts), and the sender's own leg
  // dying mid-transfer is the EXPECTED shape of a blind transfer (Telnyx
  // unbridges the sender when the target answers), not a stranded owner. A
  // bare clearIntent would re-run T7's stood-down teardown against the OLD
  // owner and force-hang the customer ~40s after a SUCCESSFUL transfer, and
  // skipping both leaves the intent-expiry alarm to do the same. Same idiom
  // and failure posture as consult/complete (routes/live-calls.ts): errors
  // propagate into the webhook ledger for retry.
  const stub = callSessionStub(env, state.sessionId);
  if (stub) {
    await stub.setOwner({
      sessionId: state.sessionId,
      userId: state.targetUserId,
    });
    await stub.clearIntent();
  }

  const call = await liveCallBySession(db, state.sessionId);

  // #211 (D11): for an OUTBOUND call the blind transfer was a consult-style dial
  // (issueTransfer), so the target answering does NOT auto-bridge — bridge-STEAL
  // the customer (oc) leg onto the now-answered target leg, dropping the placer.
  // This is the SAME proven mechanic consult/complete runs against customer
  // ccids. Ordering mirrors consult/complete: DB owner stamp -> DO
  // setOwner+clearIntent (above) -> bridge-steal. 4xx-tolerant: a dead customer
  // leg means the call is already ending (its own hangup runs T-O3), so a false
  // return here never strands anything. (Inbound skips this — Telnyx's transfer
  // command already bridged the target and dropped the sender.)
  if (
    call?.direction === "outbound" &&
    call.customer_call_control_id &&
    realLegCcid
  ) {
    await telnyxOnLiveLeg(env, `/v2/calls/${realLegCcid}/actions/bridge`, {
      call_control_id: call.customer_call_control_id,
    });
  }

  if (!call?.conversation_id) return; // unthreaded (anonymous) — list-only
  await insertJourneyEvent(db, {
    companyId,
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
  attempt?: { memberCcid?: string; explicitlyDeclined: boolean },
): Promise<void> {
  if (state.transferId) {
    const stub = callSessionStub(env, state.sessionId);
    if (!stub) throw new Error("registered transfer has no session binding");
    const result = await stub.endTransferAttempt({
      transferId: state.transferId,
      wakeId: state.wakeId,
      userId: state.targetUserId,
      memberCcid: attempt?.memberCcid,
      waitForWake: !attempt?.explicitlyDeclined,
    });
    if (result === "bridged") return;
    const { error } = await db.from("call_member_legs").update({ state: "failed" })
      .eq("call_session_id", state.sessionId).eq("call_control_id", transferLegToken(state))
      .eq("user_id", state.targetUserId).eq("kind", "transfer").eq("state", "ringing");
    if (error) throw new Error(`transfer close failed: ${error.message}`);
    return;
  }
  // Mark this transfer intent terminal so a replay can't re-drive recovery.
  // Only a MISSED transfer (timeout/decline/busy) that WON the transition
  // proceeds — a normal end-of-call hangup carries no verdict, and a replay
  // matches zero rows.
  const { data: closed, error: closeError } = await db
    .from("call_member_legs")
    .update({ state: "failed" })
    .eq("call_session_id", state.sessionId)
    .eq("call_control_id", transferLegToken(state))
    .eq("user_id", state.targetUserId)
    .eq("kind", "transfer")
    .eq("state", "ringing")
    .select("call_control_id");
  if (closeError) {
    throw new Error(`transfer close failed: ${closeError.message}`);
  }
  if (!missed || (closed?.length ?? 0) === 0) return;

  const call = await liveCallBySession(db, state.sessionId);
  if (!call?.customer_call_control_id) return;
  if (call.outcome !== null) return; // the call already ended — nothing to save

  // #211: an OUTBOUND blind transfer is consult-style — the placer is NOT
  // unbridged until the bridge-steal succeeds (handleTransferAnswered), so a
  // MISSED target leaves the placer STILL connected to the customer. The ledger
  // is already marked failed above; there is nothing to recover. Return WITHOUT
  // snapping back (never re-dial the placer, who never left) and WITHOUT hanging
  // up the customer (which the placer still holds). The inbound snap-back below
  // exists only because Telnyx's transfer command unbridges the sender at issue.
  if (call.direction === "outbound") return;

  if (state.hops < MAX_TRANSFER_HOPS) {
    // Snap the customer back to the sender.
    const { data, error } = await db
      .from("member_telephony_credentials")
      .select("sip_username")
      .eq("company_id", call.company_id)
      .eq("user_id", state.senderUserId)
      .limit(1);
    if (error) throw new Error(`credential read failed: ${error.message}`);
    const sip = data?.[0]?.sip_username as string | undefined;
    if (sip) {
      const issued = await issueTransfer(env, db, {
        companyId: call.company_id,
        customerCcid: call.customer_call_control_id,
        targetSipUsername: sip,
        callerNumberForTarget:
          state.caller ?? (await businessNumberFor(db, call)),
        // Inbound-only path (we returned above for outbound): the Telnyx
        // transfer command re-rings the sender's browser and re-bridges.
        direction: "inbound",
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

  // Hop cap (or no sender credential): end the customer leg CLEANLY. Hanging
  // up bills the pre-transfer talk time correctly (the in_browser/out_customer
  // hangup) — re-tagging the answered leg to voicemail would lose that bill
  // and, if `answer` 4xxs on the already-answered leg, strand the caller in
  // silence. A caller who wants to leave a message redials into voicemail.
  await hangupLiveLeg(env, call.customer_call_control_id);
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
    // Only proceed if THIS is a ledgered consult leg of the session (the
    // update matched a real row) — mirrors handleTransferAnswered and the
    // consult-hangup branch. A forged/stale brc tag matches zero rows and must
    // never reach the bridge command below (which would STEAL a live leg).
    const { data: claimed, error } = await db
      .from("call_member_legs")
      .update({ state: "answered" })
      .eq("call_session_id", state.sessionId)
      .eq("call_control_id", ccid)
      .eq("kind", "consult")
      .select("call_control_id");
    if (error) throw new Error(`consult stamp failed: ${error.message}`);
    if ((claimed?.length ?? 0) === 0) return;

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
    // Only dismiss the sibling if THIS was a live consult leg of the session
    // (the update matched a real ledger row). A FORGED brc tag naming a
    // victim's session — or a hangup arriving AFTER /consult/complete deleted
    // the ledger rows (the customer is now bridged onto the target leg and
    // must NOT be torn down) — matches zero rows and is ignored.
    const { data: closed, error } = await db
      .from("call_member_legs")
      .update({ state: "failed" })
      .eq("call_session_id", state.sessionId)
      .eq("call_control_id", ccid)
      .eq("kind", "consult")
      .neq("state", "failed")
      .select("call_control_id");
    if (error) throw new Error(`consult hangup stamp failed: ${error.message}`);
    if ((closed?.length ?? 0) === 0) return;

    // Dismiss any still-live sibling consult leg (a member declined the
    // consult before it completed — never leave the other listening to
    // silence). Idempotent; dead legs 4xx and are swallowed.
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
  return (data ?? []);
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
