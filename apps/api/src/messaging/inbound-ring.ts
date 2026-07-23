/**
 * #135 (D43) inbound-call shared vocabulary and the voicemail storage
 * pipeline. The ring/voicemail ORCHESTRATION now lives in the CallSessionDO
 * (calls-v3, docs/CALLS-V3.md); this module keeps only the pieces that
 * orchestration and voice-webhook.ts import:
 *
 *   STATE TAGS. The client_state grammar for the three inbound leg motions,
 *   with the builders/parsers the DO and the webhook router key off:
 *     - `brm|<session>|<user_id>|<caller-or-empty>|<inbound_ccid>` — a member
 *       ring leg (ccid LAST, it is the only pipe-risky field).
 *     - `bri|<caller-or-empty>|<answeredAtIso>` — the INBOUND leg once a
 *       browser answers; the ISO stamp is the talk-time billing anchor.
 *     - `vmi|<caller-or-empty>` — the INBOUND leg once it enters voicemail.
 *
 *   SIP HEADERS. The two X- prefixed custom headers a ring dial rides
 *   (session correlation + real caller id) that the Android client reads.
 *
 *   GREETING. defaultGreeting / sanitizeGreeting bound and clean the
 *   owner-authored voicemail greeting before it reaches the speak command.
 *
 *   VOICEMAIL STORE. call.recording.saved (vmi leg) fetches Telnyx's copy
 *   inside its 10-minute presigned window, stores it in the private
 *   'voicemails' bucket, stamps the calls row, and DELETES the Telnyx copy so
 *   customer audio never persists on a third party. insertVoicemailEvent drops
 *   the timeline line; recoverStoredVoicemail rebuilds the record on a replay.
 *
 *   hangupLiveLeg ends an already-answered leg cleanly (transfer-recovery
 *   terminus), swallowing the routine 4xx of a leg the caller already dropped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";

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

/** Custom SIP header (CALLS-CLIENT-V2 §3.2) stamped on EVERY member ring dial
 *  (initial fan-out AND ring-me re-dial), value = `call_session_id`. The
 *  Android client reads it off the inbound verto INVITE to correlate the media
 *  leg to its authoritative server session DETERMINISTICALLY — never by a
 *  caller/time heuristic. Telnyx WebRTC only passes custom headers whose name
 *  starts with `X-`, so this prefix is MANDATORY. Additive + backward-compatible:
 *  an older server that omits it degrades to the client's by-leg fallback. */
export const LOONEXT_SESSION_HEADER = "X-Loonext-Session";

/** Custom SIP header (#212) carrying the REAL caller's E.164 on every member
 *  ring dial. Telnyx rewrites the SIP `from` to a connection-owned number (the
 *  business number) for WebRTC originations, so the INVITE's callerIdNumber the
 *  client sees is the business number, NOT the caller. The true caller is known
 *  server-side (input.callerE164) and is handed to the client on this trusted
 *  header, same discipline as {@link LOONEXT_SESSION_HEADER}, X- prefix
 *  MANDATORY (Telnyx WebRTC only forwards `X-`-prefixed custom headers). Emitted
 *  ONLY when the caller is known: a null caller (CLIR/anonymous) sends no header
 *  and the client shows "Unknown caller" rather than the business number.
 *  A caller NAME/CNAM is NOT plumbed onto the ring input (the DO contract does
 *  not carry caller_name, which is #211 territory), so no `X-Loonext-Caller-Name`
 *  is emitted here; the client already reads it forward-compatibly if it lands. */
export const LOONEXT_CALLER_HEADER = "X-Loonext-Caller";

/** Ring window for member browser legs. Long enough (#135 push-to-wake) that a
 *  mobile member has time to be pushed, tap, open the app, and answer — while
 *  the caller keeps hearing ringback. */
export const RING_TIMEOUT_SECS = 45;

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

/** The greeting spoken when the owner has not written one. */
export function defaultGreeting(companyName: string): string {
  return (
    `You've reached ${companyName}. We can't take your call right now. ` +
    `Please leave a message after the beep, or hang up and text us at this number.`
  );
}

/** TTS input is owner-authored — bound it and strip control characters so a
 *  pathological greeting can never wedge the speak command. */
export function sanitizeGreeting(raw: string | null, companyName: string): string {
  const text = (raw ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  return text ? text.slice(0, 500) : defaultGreeting(companyName);
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
