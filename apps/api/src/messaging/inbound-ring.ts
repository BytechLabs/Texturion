/**
 * #135 (D43) phase 2: the browser is the phone — the inbound ring engine and
 * the voicemail pipeline. Dispatched from voice-webhook.ts (which owns event
 * routing, leg classification, billing, and threading); this module owns the
 * three inbound-call motions:
 *
 *   RING — an inbound call to a company number dials EVERY eligible member's
 *   WebRTC credential (`sip:<username>@sip.telnyx.com`) as parallel legs.
 *   The inbound leg is NOT answered while ringing — the caller hears real
 *   carrier ringback and we bill nothing until a human exists. Eligible =
 *   active member, holding a credential (they've opened the app and the
 *   softphone registered), and #106 'text'-level access to the receiving
 *   number (owners/admins always; a notes-only or hidden member must never
 *   answer a customer). First answer WINS via api_claim_ring_answer (atomic,
 *   webhook events land concurrently): the winner answers the inbound leg
 *   (stamping the `bri|<caller>|<answeredAt>` tag that anchors talk-time
 *   billing), bridges the two, and hangs up the losers. The LAST leg to fail
 *   with no winner (api_ring_leg_failed, exactly-once) starts voicemail.
 *
 *   VOICEMAIL — answer (tagging `vmi|<caller>`), speak the owner-authored
 *   greeting (or an honest default), then on call.speak.ended record up to
 *   {@link VOICEMAIL_MAX_SECS}s (beep, mp3). call.recording.saved fetches
 *   Telnyx's copy inside its 10-minute presigned window, stores it in the
 *   private 'voicemails' bucket, stamps the calls row, upgrades the outcome
 *   to 'voicemail' (the merge rule lets it beat the hangup's 'missed'),
 *   drops a voicemail timeline event, and DELETES the Telnyx copy — we never
 *   leave customer audio on a third party.
 *
 *   CANCEL — the caller giving up mid-ring hangs up the inbound leg; the
 *   terminal handler calls {@link cancelRingingMemberLegs} so browsers stop
 *   ringing a dead call. Their hangups mark legs failed; the "last leg"
 *   voicemail then no-ops because answering a dead inbound leg fails (caught
 *   — the missed text-back already ran off the inbound hangup).
 *
 * Replay safety: the ring is guarded by the call_member_legs ledger (a
 * replayed call.initiated sees existing rows and does not re-dial); claim
 * and last-leg decisions are SQL-atomic; the voicemail store upserts by
 * session-keyed path; the timeline event is dedupe-scanned. Telnyx commands
 * on dead legs 4xx — callers catch and continue, because a dead leg always
 * means the terminal path already owns the outcome.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { levelFromRules, type NumberAccessRule } from "../auth/number-access";
import type { Env } from "../env";
import { notifyIncomingCall } from "../notifications/incoming-call";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";
// Function-level circular import (voice-webhook imports this module's
// handlers): safe — neither module calls the other at load time.
import { threadCallSession } from "./voice-webhook";

/** client_state tag on each member ring leg:
 *  `brm|<session>|<user_id>|<caller-or-empty>|<inbound_ccid>` (ccid LAST —
 *  it is the only pipe-risky field, so it takes the remainder). */
export const BROWSER_MEMBER_STATE = "brm";

/** client_state stamped on the INBOUND leg when a browser answers:
 *  `bri|<caller-or-empty>|<answeredAtIso>` — the ISO stamp is the talk-time
 *  anchor (inbound start_time includes ring time, which must never bill). */
export const BROWSER_INBOUND_STATE = "bri";

/** client_state on the INBOUND leg once it enters voicemail:
 *  `vmi|<caller-or-empty>`. */
export const VOICEMAIL_INBOUND_STATE = "vmi";

/** Ring window for member browser legs. Long enough (#135 push-to-wake) that a
 *  mobile member has time to be pushed, tap, open the app, and answer — while
 *  the caller keeps hearing ringback. */
export const RING_TIMEOUT_SECS = 45;

/** Hard cap on one voicemail recording. */
export const VOICEMAIL_MAX_SECS = 120;

/** Recordings shorter than this are a hangup-on-the-beep, not a message. */
const VOICEMAIL_MIN_SECS = 2;

/** The private storage bucket voicemail mp3s live in. */
export const VOICEMAILS_BUCKET = "voicemails";

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

export function buildMemberRingState(input: {
  sessionId: string;
  userId: string;
  caller: string | null;
  inboundCcid: string;
}): string {
  return b64encode(
    `${BROWSER_MEMBER_STATE}|${input.sessionId}|${input.userId}|${input.caller ?? ""}|${input.inboundCcid}`,
  );
}

export interface MemberRingState {
  sessionId: string;
  userId: string;
  caller: string | null;
  inboundCcid: string;
}

export function parseMemberRingState(
  raw: string | null | undefined,
): MemberRingState | null {
  const decoded = b64decode(raw);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== BROWSER_MEMBER_STATE || parts.length < 5) return null;
  const [, sessionId, userId, caller, ...ccid] = parts;
  const inboundCcid = ccid.join("|");
  if (!sessionId || !userId || !inboundCcid) return null;
  return { sessionId, userId, caller: caller || null, inboundCcid };
}

export function buildBrowserAnsweredState(
  caller: string | null,
  answeredAtIso: string,
): string {
  return b64encode(`${BROWSER_INBOUND_STATE}|${caller ?? ""}|${answeredAtIso}`);
}

/** The talk-time anchor from a `bri` inbound leg's client_state (ms epoch),
 *  or null when absent/garbled — the caller then bills zero, never ring time. */
export function parseBrowserAnsweredAtMs(
  raw: string | null | undefined,
): number | null {
  const decoded = b64decode(raw);
  if (!decoded) return null;
  const parts = decoded.split("|");
  if (parts[0] !== BROWSER_INBOUND_STATE || parts.length < 3) return null;
  const ms = Date.parse(parts[2] ?? "");
  return Number.isFinite(ms) ? ms : null;
}

export function buildVoicemailState(caller: string | null): string {
  return b64encode(`${VOICEMAIL_INBOUND_STATE}|${caller ?? ""}`);
}

/** True when Telnyx's flag-mode screening verdict marks the caller bad. The
 *  raw string is stored on the calls row either way; this only drives the
 *  'divert' routing choice, so unknown vocabulary fails OPEN (ring the team —
 *  a false negative rings a scam once; a false positive silences a customer). */
export function screeningFlagged(result: string | null | undefined): boolean {
  if (!result) return false;
  const value = result.toLowerCase();
  if (value.includes("no_flag") || value.includes("clean")) return false;
  return ["spam", "fraud", "scam", "robo", "flag", "spoof"].some((marker) =>
    value.includes(marker),
  );
}

/** A Telnyx command on a leg that already ended 4xxs — the routine race of
 *  telephony (caller hung up first). Those are swallowed; real faults rethrow. */
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

interface RingInput {
  callControlId: string; // the inbound (customer) leg
  callSessionId: string;
  callerE164: string | null;
  businessNumberE164: string;
  companyId: string;
  phoneNumberId: string;
  companyName: string;
  voicemailGreeting: string | null;
}

/**
 * Dial every eligible member's browser; when nobody is dialable, go straight
 * to voicemail. Replay-safe: existing call_member_legs rows for the session
 * mean a previous pass already rang (or is ringing) — never re-dial.
 */
export async function ringMembersOrVoicemail(
  env: Env,
  db: SupabaseClient,
  input: RingInput,
): Promise<void> {
  const { data: existing, error: existingError } = await db
    .from("call_member_legs")
    .select("call_control_id")
    .eq("call_session_id", input.callSessionId)
    .limit(1);
  if (existingError) {
    throw new Error(`ring ledger read failed: ${existingError.message}`);
  }
  if ((existing ?? []).length > 0) return; // replayed initiated — already rung

  const targets = await eligibleRingTargets(
    db,
    input.companyId,
    input.phoneNumberId,
  );
  if (targets.length === 0) {
    await startVoicemail(env, {
      callControlId: input.callControlId,
      caller: input.callerE164,
      companyName: input.companyName,
      greeting: input.voicemailGreeting,
    });
    return;
  }

  // Push-to-wake (#135): alert every eligible member on their PHONE in parallel
  // with the browser ring. A mobile tab that's been suspended can't render the
  // in-app ring, so without this a phone stays silent. Fire-and-forget and
  // never-throwing — a push failure must not disturb the ring/voicemail path.
  void notifyIncomingCall(env, db, {
    userIds: targets.map((t) => t.userId),
    caller: input.callerE164,
    callSessionId: input.callSessionId,
  });

  // The ring leg is a Call Control dial, which MUST originate from a Call
  // Control APPLICATION — the number's voice connection
  // (TELNYX_VOICE_CONNECTION_ID). A credential connection (where the browsers
  // register) CANNOT originate `POST /v2/calls` — Telnyx rejects it, the dial
  // throws, no leg is ledgered, and the call falls to voicemail with the browser
  // never ringing (#135 regression, 2026-07-13). What makes the
  // `sip:<sip_username>@sip.telnyx.com` INVITE resolve to the registered browser
  // is `sip_uri_calling_preference:'internal'` on the WebRTC credential
  // connection (set once, docs/deploy/04-telnyx.md) — NOT the originating
  // connection. So: originate from the Call Control app, resolve via the
  // credential connection's preference.
  // One Dial per member browser. Per-target try/catch: one member's dead
  // credential must not silence the rest of the team. Legs are ledgered as
  // they land so the answer/failure races have rows to decide on.
  const dialed: { ccid: string; userId: string }[] = [];
  for (const target of targets) {
    try {
      const response = (await telnyxRequest(env, {
        method: "POST",
        path: "/v2/calls",
        body: {
          connection_id: env.TELNYX_VOICE_CONNECTION_ID,
          to: `sip:${target.sipUsername}@sip.telnyx.com`,
          // The member's browser shows who is calling — the real caller when
          // known, the business number for anonymous/CLIR callers.
          from: input.callerE164 ?? input.businessNumberE164,
          timeout_secs: RING_TIMEOUT_SECS,
          client_state: buildMemberRingState({
            sessionId: input.callSessionId,
            userId: target.userId,
            caller: input.callerE164,
            inboundCcid: input.callControlId,
          }),
        },
      })) as { data?: { call_control_id?: string } };
      const ccid = response.data?.call_control_id;
      if (ccid) dialed.push({ ccid, userId: target.userId });
    } catch (cause) {
      console.error(
        `member ring dial failed (user ${target.userId}):`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  if (dialed.length === 0) {
    await startVoicemail(env, {
      callControlId: input.callControlId,
      caller: input.callerE164,
      companyName: input.companyName,
      greeting: input.voicemailGreeting,
    });
    return;
  }

  const { error: insertError } = await db.from("call_member_legs").insert(
    dialed.map((leg) => ({
      call_session_id: input.callSessionId,
      call_control_id: leg.ccid,
      company_id: input.companyId,
      user_id: leg.userId,
    })),
  );
  if (insertError) {
    // COMPENSATE: the legs are already ringing but unledgered — a replay would
    // re-dial the WHOLE team (the guard reads the empty ledger) and a fast
    // answer would find no row to claim. Hang EVERY just-dialed leg up so the
    // replay starts clean. Each hangup is best-effort in its own try/catch so
    // a single 5xx can't abort the loop and strand the rest, then rethrow to
    // the ledger sweeper.
    for (const leg of dialed) {
      try {
        await telnyxOnLiveLeg(env, `/v2/calls/${leg.ccid}/actions/hangup`, {});
      } catch (cause) {
        console.error(
          `ring compensation hangup failed for ${leg.ccid}:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    }
    throw new Error(`ring ledger insert failed: ${insertError.message}`);
  }
}

/**
 * Push-to-wake (#135): (re-)ring ONE member's browser for a call that is ALREADY
 * live — the customer is on the line hearing ringback. Called by
 * POST /v1/calls/live/:sessionId/ring-me when a member opens the app from an
 * incoming-call push: dial their now-awake browser so the ringing call surfaces
 * and they can answer it. Cancels only THIS member's own stale (suspended-tab)
 * ring leg first (#137 — never the rest of the team's), then dials one fresh leg
 * and ledgers it. Returns the new leg's control id, or null if Telnyx returned none.
 */
export async function ringMemberBrowser(
  env: Env,
  db: SupabaseClient,
  input: {
    callSessionId: string;
    companyId: string;
    userId: string;
    sipUsername: string;
    caller: string | null;
    businessNumberE164: string;
    inboundCcid: string;
  },
): Promise<string | null> {
  // Clear ONLY this member's own stale (suspended-tab) ring leg — never the
  // rest of the team's still-ringing browsers (#137).
  await cancelRingingMemberLegsForUser(
    env,
    db,
    input.callSessionId,
    input.userId,
  );

  const response = (await telnyxRequest(env, {
    method: "POST",
    path: "/v2/calls",
    body: {
      connection_id: env.TELNYX_VOICE_CONNECTION_ID,
      to: `sip:${input.sipUsername}@sip.telnyx.com`,
      from: input.caller ?? input.businessNumberE164,
      timeout_secs: RING_TIMEOUT_SECS,
      client_state: buildMemberRingState({
        sessionId: input.callSessionId,
        userId: input.userId,
        caller: input.caller,
        inboundCcid: input.inboundCcid,
      }),
    },
  })) as { data?: { call_control_id?: string } };
  const ccid = response.data?.call_control_id;
  if (!ccid) return null;

  const { error } = await db.from("call_member_legs").insert({
    call_session_id: input.callSessionId,
    call_control_id: ccid,
    company_id: input.companyId,
    user_id: input.userId,
  });
  if (error) {
    try {
      await telnyxOnLiveLeg(env, `/v2/calls/${ccid}/actions/hangup`, {});
    } catch {
      /* best-effort — an orphan leg self-heals when it times out */
    }
    throw new Error(`ring-me ledger insert failed: ${error.message}`);
  }
  return ccid;
}

/**
 * Who rings: active members holding a WebRTC credential whose #106 level for
 * the receiving number is 'text' (owners/admins unrestricted, per the
 * resolver's own rule). 'note'/hidden members never take customer calls.
 */
async function eligibleRingTargets(
  db: SupabaseClient,
  companyId: string,
  phoneNumberId: string,
): Promise<{ userId: string; sipUsername: string }[]> {
  const [credentials, members, rules] = await Promise.all([
    db
      .from("member_telephony_credentials")
      .select("user_id,sip_username")
      .eq("company_id", companyId),
    db
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", companyId)
      .is("deactivated_at", null),
    db
      .from("number_access")
      .select("phone_number_id,principal_kind,principal,level")
      .eq("company_id", companyId)
      .eq("phone_number_id", phoneNumberId),
  ]);
  if (credentials.error) {
    throw new Error(`credential list failed: ${credentials.error.message}`);
  }
  if (members.error) {
    throw new Error(`member list failed: ${members.error.message}`);
  }
  if (rules.error) {
    throw new Error(`number_access read failed: ${rules.error.message}`);
  }
  const roleByUser = new Map(
    (members.data ?? []).map((m) => [m.user_id as string, m.role as string]),
  );
  const accessRules = (rules.data ?? []) as NumberAccessRule[];

  const targets: { userId: string; sipUsername: string }[] = [];
  for (const cred of credentials.data ?? []) {
    const userId = cred.user_id as string;
    const role = roleByUser.get(userId);
    if (!role) continue; // deactivated — credential revocation is best-effort
    const level =
      role === "owner" || role === "admin"
        ? "text"
        : levelFromRules(accessRules, userId, role as "admin" | "member");
    if (level !== "text") continue;
    targets.push({ userId, sipUsername: cred.sip_username as string });
  }
  return targets;
}

/**
 * A member's browser answered. Decide the race atomically; the winner
 * answers + bridges the customer and dismisses the rest of the team.
 */
export async function handleMemberRingAnswered(
  env: Env,
  db: SupabaseClient,
  memberCcid: string,
  state: MemberRingState,
): Promise<void> {
  const { data: verdict, error } = await db.rpc("api_claim_ring_answer", {
    p_call_session_id: state.sessionId,
    p_call_control_id: memberCcid,
  });
  if (error) {
    throw new Error(`api_claim_ring_answer failed: ${error.message}`);
  }
  // 'lost' = a sibling won (or this leg never rang) — dismiss THIS browser.
  // 'won'  = this pass claimed the call — run the full connect.
  // 'already' = a webhook REPLAY of the leg that already won — re-run the
  //   connect IDEMPOTENTLY (never hang the winner up; the answer/bridge just
  //   4xx-and-continue) so a first pass that threw mid-sequence completes.
  if (verdict === "lost") {
    await telnyxOnLiveLeg(env, `/v2/calls/${memberCcid}/actions/hangup`, {});
    return;
  }
  const isReplay = verdict === "already";

  // Stamp answered_at/by FIRST (guarded on null) — this is the durable
  // "this member won" signal, committed before the risky Telnyx calls so a
  // throw-then-replay is recognised as 'already' and never hangs the winner.
  const answeredAtIso = new Date().toISOString();
  const { error: stampError } = await db
    .from("calls")
    .update({ answered_by_user_id: state.userId, answered_at: answeredAtIso })
    .eq("call_session_id", state.sessionId)
    .is("answered_at", null);
  if (stampError) {
    throw new Error(`answered stamp failed: ${stampError.message}`);
  }

  // Answer the customer leg with the bri billing anchor. On the FIRST win a
  // failure means the caller hung up in the answer window (dead leg) → release
  // the member. On a REPLAY the leg is already answered (4xx) → continue.
  const answered = await telnyxOnLiveLeg(
    env,
    `/v2/calls/${state.inboundCcid}/actions/answer`,
    { client_state: buildBrowserAnsweredState(state.caller, answeredAtIso) },
  );
  if (!answered && !isReplay) {
    // Caller gone in the answer window (the answer command 4xx'd on the dead
    // inbound leg). The member's SIP leg is ALREADY ACTIVE (call.answered is
    // what fired this) and now bridged to nothing — HANG IT UP so the member
    // isn't stranded on a silent connected call holding a concurrent-call
    // slot (nothing else reclaims it: cancelRingingMemberLegs only touches
    // 'ringing' legs and this one is 'answered'; the runaway sweep acts on the
    // customer leg, not the member's).
    await telnyxOnLiveLeg(env, `/v2/calls/${memberCcid}/actions/hangup`, {});
    // Undo the early answered stamp (guarded on outcome still null) so the
    // call doesn't read as a 0-second 'answered' — the untagged inbound
    // hangup resolves it as the miss it was.
    await db
      .from("calls")
      .update({ answered_by_user_id: null, answered_at: null })
      .eq("call_session_id", state.sessionId)
      .is("outcome", null);
    return;
  }

  const bridged = await telnyxOnLiveLeg(
    env,
    `/v2/calls/${memberCcid}/actions/bridge`,
    { call_control_id: state.inboundCcid },
  );
  if (!bridged && !isReplay) {
    // Bridge failed: EITHER the member leg died between answer and bridge, OR
    // the CALLER hung up in that window (bridge 4xxs on either dead leg). Hang
    // up BOTH — the member's active SIP leg must not be left bridged to
    // nothing (a silent stranded call holding a concurrent slot), and the
    // inbound leg (if it's the survivor) must not be left answered into dead
    // air. A hangup on the already-dead one 4xx-swallows.
    await telnyxOnLiveLeg(env, `/v2/calls/${memberCcid}/actions/hangup`, {});
    await telnyxOnLiveLeg(
      env,
      `/v2/calls/${state.inboundCcid}/actions/hangup`,
      {},
    );
    // The inbound leg was already answered (bri tag), so its hangup won't
    // classify as inbound_untagged → cancelRingingMemberLegs won't fire for it.
    // Dismiss the OTHER still-ringing browsers here so no teammate rings a
    // call that is already dead.
    await cancelRingingMemberLegs(env, db, state.sessionId);
    return;
  }

  // D43 phase 3: thread the call at ANSWER time (create the conversation for
  // a first-time caller) so the member can take notes DURING the call — the
  // call bar deep-links to it. Idempotent per session; the hangup pass later
  // just updates duration on the calls row. Best-effort: a threading fault
  // must never kill the answer (the bridge already happened).
  try {
    const { data: rows, error: rowError } = await db
      .from("calls")
      .select("company_id,phone_number_id,caller_e164")
      .eq("call_session_id", state.sessionId)
      .limit(1);
    if (rowError) throw new Error(rowError.message);
    const row = rows?.[0] as
      | {
          company_id: string;
          phone_number_id: string | null;
          caller_e164: string | null;
        }
      | undefined;
    if (row?.phone_number_id) {
      await threadCallSession(db, {
        companyId: row.company_id,
        phoneNumberId: row.phone_number_id,
        callSessionId: state.sessionId,
        caller: row.caller_e164 ?? state.caller,
        outcome: "answered",
        forwardSeconds: 0,
        direction: "inbound",
      });
    }
  } catch (cause) {
    console.error(
      `answer-time threading failed for ${state.sessionId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  // Dismiss the rest of the team.
  const { data: siblings, error: siblingError } = await db
    .from("call_member_legs")
    .select("call_control_id")
    .eq("call_session_id", state.sessionId)
    .eq("state", "ringing")
    .neq("call_control_id", memberCcid);
  if (siblingError) {
    throw new Error(`sibling read failed: ${siblingError.message}`);
  }
  for (const sibling of siblings ?? []) {
    await telnyxOnLiveLeg(
      env,
      `/v2/calls/${sibling.call_control_id as string}/actions/hangup`,
      {},
    );
  }
}

/**
 * A member ring leg ended without winning (timeout, decline, offline
 * browser, or dismissed by the winner). When it was the LAST live leg and
 * nobody answered, the caller gets voicemail — exactly once, the RPC
 * serializes concurrent failures.
 */
export async function handleMemberRingHangup(
  env: Env,
  db: SupabaseClient,
  memberCcid: string,
  state: MemberRingState,
): Promise<void> {
  const { data: last, error } = await db.rpc("api_ring_leg_failed", {
    p_call_session_id: state.sessionId,
    p_call_control_id: memberCcid,
  });
  if (error) {
    throw new Error(`api_ring_leg_failed failed: ${error.message}`);
  }
  if (last !== true) return;

  const company = await companyForSession(db, state.sessionId);
  if (!company) return;
  await startVoicemail(env, {
    callControlId: state.inboundCcid,
    caller: state.caller,
    companyName: company.name,
    greeting: company.voicemailGreeting,
  });
}

async function companyForSession(
  db: SupabaseClient,
  sessionId: string,
): Promise<{ name: string; voicemailGreeting: string | null } | null> {
  const { data, error } = await db
    .from("calls")
    .select("company_id")
    .eq("call_session_id", sessionId)
    .limit(1);
  if (error) throw new Error(`calls read failed: ${error.message}`);
  const companyId = data?.[0]?.company_id as string | undefined;
  if (!companyId) return null;
  const { data: rows, error: companyError } = await db
    .from("companies")
    .select("name,voicemail_greeting")
    .eq("id", companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`company read failed: ${companyError.message}`);
  }
  const row = rows?.[0] as
    | { name: string; voicemail_greeting: string | null }
    | undefined;
  return row
    ? { name: row.name, voicemailGreeting: row.voicemail_greeting }
    : null;
}

/** The greeting spoken when the owner has not written one. */
export function defaultGreeting(companyName: string): string {
  return (
    `You've reached ${companyName}. We can't take your call right now. ` +
    `Please leave a message after the beep, or hang up and text us at this number.`
  );
}

/** TTS input is owner-authored — bound it and strip control characters so a
 *  pathological greeting can never wedge the speak command. */
function sanitizeGreeting(raw: string | null, companyName: string): string {
  const text = (raw ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  return text ? text.slice(0, 500) : defaultGreeting(companyName);
}

/**
 * Put the inbound leg into voicemail: answer (routine-failure = the caller
 * already hung up; the missed path owns it), then speak the greeting. The
 * speak's `vmi` tag routes call.speak.ended → record_start.
 */
export async function startVoicemail(
  env: Env,
  input: {
    callControlId: string;
    caller: string | null;
    companyName: string;
    greeting: string | null;
  },
): Promise<void> {
  const state = buildVoicemailState(input.caller);
  const answered = await telnyxOnLiveLeg(
    env,
    `/v2/calls/${input.callControlId}/actions/answer`,
    { client_state: state },
  );
  if (!answered) return; // dead leg — the inbound hangup already ran the miss
  await telnyxOnLiveLeg(env, `/v2/calls/${input.callControlId}/actions/speak`, {
    payload: sanitizeGreeting(input.greeting, input.companyName),
    voice: "female",
    language: "en-US",
    client_state: state,
  });
}

/** End an ALREADY-answered leg cleanly (transfer-recovery terminus). Hanging
 *  up bills the talk time correctly via the in_browser/out_customer hangup —
 *  re-tagging the live leg to voicemail would instead lose that bill and
 *  strand the caller if `answer` 4xxs on the answered leg. A caller who wants
 *  to leave a message redials and reaches voicemail (no team answers). */
export async function hangupLiveLeg(
  env: Env,
  callControlId: string,
): Promise<void> {
  await telnyxOnLiveLeg(env, `/v2/calls/${callControlId}/actions/hangup`, {});
}

/** Greeting finished — open the recorder (beep, mp3, hard cap). */
export async function handleVoicemailSpeakEnded(
  env: Env,
  callControlId: string,
): Promise<void> {
  await telnyxOnLiveLeg(
    env,
    `/v2/calls/${callControlId}/actions/record_start`,
    {
      format: "mp3",
      channels: "single",
      play_beep: true,
      max_length: VOICEMAIL_MAX_SECS,
      // Stop on sustained silence so nobody has to wait out the cap.
      timeout_secs: 15,
    },
  );
}

/** The caller gave up mid-ring: stop every browser still ringing this
 *  session. Their hangups mark legs failed; the last-leg voicemail then
 *  no-ops on the dead inbound leg. */
export async function cancelRingingMemberLegs(
  env: Env,
  db: SupabaseClient,
  callSessionId: string,
): Promise<void> {
  const { data, error } = await db
    .from("call_member_legs")
    .select("call_control_id")
    .eq("call_session_id", callSessionId)
    .eq("state", "ringing");
  if (error) throw new Error(`ring cancel read failed: ${error.message}`);
  for (const leg of data ?? []) {
    await telnyxOnLiveLeg(
      env,
      `/v2/calls/${leg.call_control_id as string}/actions/hangup`,
      {},
    );
  }
}

/** Like {@link cancelRingingMemberLegs} but scoped to ONE member (#137). The
 *  push-to-wake re-ring clears only the requester's OWN stale suspended-tab leg
 *  before dialing them fresh — the rest of the team's browsers keep ringing, so
 *  waking one member never silences the crew. */
async function cancelRingingMemberLegsForUser(
  env: Env,
  db: SupabaseClient,
  callSessionId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await db
    .from("call_member_legs")
    .select("call_control_id")
    .eq("call_session_id", callSessionId)
    .eq("user_id", userId)
    .eq("state", "ringing");
  if (error) throw new Error(`ring cancel read failed: ${error.message}`);
  for (const leg of data ?? []) {
    await telnyxOnLiveLeg(
      env,
      `/v2/calls/${leg.call_control_id as string}/actions/hangup`,
      {},
    );
  }
}

interface RecordingSavedPayload {
  call_session_id?: string;
  call_control_id?: string;
  client_state?: string | null;
  from?: string;
  to?: string;
  recording_urls?: { mp3?: string; wav?: string };
  recording_started_at?: string;
  recording_ended_at?: string;
}

export interface StoredVoicemail {
  companyId: string;
  phoneNumberId: string;
  callSessionId: string;
  caller: string | null;
  seconds: number;
}

/**
 * call.recording.saved (vmi leg): copy the message into OUR storage inside
 * Telnyx's 10-minute presigned window, stamp the calls row, then delete the
 * Telnyx copy. Returns what the caller (voice-webhook) needs to upgrade the
 * outcome + thread the voicemail; null when there is nothing to keep (too
 * short, missing URL, or an expired replay — the call stays an honest miss).
 */
export async function storeVoicemailRecording(
  env: Env,
  db: SupabaseClient,
  payload: RecordingSavedPayload,
  resolved: { companyId: string; phoneNumberId: string },
  caller: string | null,
): Promise<StoredVoicemail | null> {
  const sessionId = payload.call_session_id;
  const url = payload.recording_urls?.mp3;
  if (!sessionId || !url) return null;

  const startMs = Date.parse(payload.recording_started_at ?? "");
  const endMs = Date.parse(payload.recording_ended_at ?? "");
  const seconds =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 1000))
      : 0;
  if (seconds < VOICEMAIL_MIN_SECS) {
    await deleteTelnyxRecording(env, sessionId);
    return null;
  }

  const response = await fetch(url);
  if (!response.ok) {
    // Expired presigned URL (a replay landing past the 10-minute window) or
    // a Telnyx storage fault. The recording is unrecoverable — log and leave
    // the call a miss rather than erroring into a replay loop that can never
    // succeed. Still DELETE the Telnyx copy: the "recordings must not persist
    // at Telnyx" decision holds even when we couldn't keep our own copy.
    console.error(
      `voicemail fetch failed for ${sessionId}: HTTP ${response.status}`,
    );
    await deleteTelnyxRecording(env, sessionId);
    return null;
  }
  const audio = await response.arrayBuffer();

  const path = `${resolved.companyId}/${sessionId}.mp3`;
  const upload = await db.storage
    .from(VOICEMAILS_BUCKET)
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upload.error) {
    throw new Error(`voicemail store failed: ${upload.error.message}`);
  }

  const { error: stampError } = await db
    .from("calls")
    .update({ voicemail_path: path, voicemail_seconds: seconds })
    .eq("call_session_id", sessionId);
  if (stampError) {
    throw new Error(`voicemail stamp failed: ${stampError.message}`);
  }

  // NB: the Telnyx copy is deleted by the CALLER (handleVoicemailSaved), only
  // AFTER the outcome/thread/timeline writes commit — deleting here would make
  // a replay after a downstream throw unable to re-fetch the audio (our
  // bucket recovery below handles that, but the ordering keeps the Telnyx
  // copy as a safety net until the message is durably threaded).
  return {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: sessionId,
    caller,
    seconds,
  };
}

/** Replay recovery: a voicemail already stored in OUR bucket (voicemail_path
 *  stamped) — reconstruct the StoredVoicemail from the calls row without
 *  re-fetching Telnyx (whose copy may already be deleted), so the downstream
 *  outcome/thread/timeline writes can complete on a replay. */
export function recoverStoredVoicemail(
  resolved: { companyId: string; phoneNumberId: string },
  sessionId: string,
  caller: string | null,
  voicemailSeconds: number | null,
): StoredVoicemail {
  return {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: sessionId,
    caller,
    seconds: voicemailSeconds ?? 0,
  };
}

/** Best-effort removal of Telnyx's copy — customer audio must not persist on
 *  a third party. The webhook payload carries no recording id, so list by
 *  session and delete every match. A failure logs (Telnyx retention is
 *  bounded anyway) rather than failing the pipeline. */
export async function deleteTelnyxRecording(
  env: Env,
  callSessionId: string,
): Promise<void> {
  try {
    const listing = (await telnyxRequest(env, {
      method: "GET",
      path: `/v2/recordings?filter[call_session_id]=${encodeURIComponent(callSessionId)}`,
    })) as { data?: { id?: string }[] };
    for (const recording of listing.data ?? []) {
      if (!recording.id) continue;
      await telnyxRequest(env, {
        method: "DELETE",
        path: `/v2/recordings/${recording.id}`,
      });
    }
  } catch (cause) {
    console.error(
      `telnyx recording delete failed for ${callSessionId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Drop the voicemail line into the conversation timeline (the thread is the
 * inbox's source of truth; the player fetches its signed URL per session).
 * Dedupe-scanned per session so webhook replays never double-post.
 */
export async function insertVoicemailEvent(
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    callSessionId: string;
    caller: string | null;
    seconds: number;
  },
): Promise<void> {
  const { data: existing, error: scanError } = await db
    .from("conversation_events")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("type", "call_completed")
    .eq("payload->>call_session_id", input.callSessionId)
    .eq("payload->>kind", "voicemail")
    .limit(1);
  if (scanError) {
    throw new Error(`voicemail event scan failed: ${scanError.message}`);
  }
  if ((existing ?? []).length > 0) return;

  const { error } = await db.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    actor_user_id: null,
    type: "call_completed",
    payload: {
      kind: "voicemail",
      call_session_id: input.callSessionId,
      outcome: "voicemail",
      voicemail_seconds: input.seconds,
      caller: input.caller,
    },
  });
  if (error) {
    throw new Error(`voicemail event insert failed: ${error.message}`);
  }
}
