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
import { runAiFeature } from "../ai/run";
import type { CompanyAiSettings } from "../ai/settings";
import {
  fallbackTranscriptInput,
  sanitizeTranscript,
  shouldTranscribe,
  transcriptInput,
  VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL,
  VOICEMAIL_TRANSCRIPT_FEATURE_SPEC,
  VOICEMAIL_TRANSCRIPT_MODEL,
} from "../calls/voicemail-transcript";
import {
  buildIntakeMessages,
  intakeFromRaw,
  shouldExtractIntake,
  VOICEMAIL_INTAKE_FEATURE_SPEC,
  VOICEMAIL_INTAKE_MAX_OUTPUT_TOKENS,
  VOICEMAIL_INTAKE_MODEL,
  type VoicemailIntake,
} from "../calls/voicemail-intake";

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

/**
 * What we store voicemail AS. Exported because the play route's #317
 * disposition decision depends on it: this is the one audio type
 * `rendersInlineSafely` admits, and if the recording were ever stored as
 * something else the play button would silently become a save dialog.
 */
export const VOICEMAIL_CONTENT_TYPE = "audio/mpeg";

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
/**
 * #228 — OUR default greeting, in the language the business works in.
 *
 * A workspace that never recorded one gets these words, spoken aloud to their
 * caller. They were English on every call, so a customer ringing a French
 * business heard an English sentence in that business's voice.
 *
 * The company NAME is not translated — a proper noun, and the one part of this
 * sentence that is theirs.
 */
export function defaultGreeting(companyName: string, locale?: string): string {
  if (locale === "fr-CA") {
    return (
      `Vous avez joint ${companyName}. Nous ne pouvons pas répondre pour le ` +
      `moment. Laissez un message après le signal, ou raccrochez et ` +
      `écrivez-nous à ce numéro.`
    );
  }
  return (
    `You've reached ${companyName}. We can't take your call right now. ` +
    `Please leave a message after the beep, or hang up and text us at this number.`
  );
}

/**
 * #278 — the default greeting, after hours, saying when.
 *
 * Only OUR default learns this. #518 settled that a sentence of ours appended
 * to an owner's own greeting — in our voice, on every call — is not an
 * improvement anybody asked for, and an owner who writes their own words is
 * the right person to decide what those words promise. This is the greeting a
 * workspace hears because it never wrote one, so making it honest about the
 * hours the workspace already told us is ours to do.
 *
 * `nextOpen` is null whenever we cannot honestly say when — no schedule, an
 * unresolvable timezone, nothing open inside a fortnight — and the sentence is
 * then simply absent. A caller told "back Monday at 8" who rings on Monday at
 * 8 and gets voicemail again has been lied to by a machine, and the only
 * person who ever finds out is the customer who left.
 */
export function afterHoursDefaultGreeting(
  companyName: string,
  nextOpen: string | null,
  locale?: string,
): string {
  const when = (nextOpen ?? "").trim();
  // #228: as with defaultGreeting — our words, their language. `nextOpen` is
  // formatted by the caller, so it is interpolated rather than rebuilt here.
  if (locale === "fr-CA") {
    return (
      `Vous avez joint ${companyName}. Nous sommes fermés en ce moment` +
      (when ? ` — de retour ${when}` : "") +
      `. Laissez un message après le signal, ou raccrochez et écrivez-nous à ` +
      `ce numéro, et nous vous reviendrons.`
    );
  }
  return (
    `You've reached ${companyName}. We're closed right now` +
    (when ? ` — we're back ${when}` : "") +
    `. Please leave a message after the beep, or hang up and text us at this ` +
    `number, and we'll get back to you.`
  );
}

/** TTS input is owner-authored — bound it and strip control characters so a
 *  pathological greeting can never wedge the speak command. */
export function sanitizeGreeting(
  raw: string | null,
  companyName: string,
  locale?: string,
): string {
  const text = (raw ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  // An owner's OWN greeting is returned untouched whatever the locale: they
  // wrote it, in whichever language they chose, and #518 settled that we do not
  // edit it. Only OUR fallback has a language to get right.
  return text ? text.slice(0, 500) : defaultGreeting(companyName, locale);
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
  /**
   * The words, when we got them. Carried out of the store step so the timeline
   * line can show them WITHOUT a second read per voicemail: transcription runs
   * before the event is written, so by the time the line exists we already
   * know. Null whenever there is no transcript, which is never a reason to
   * hide the audio.
   */
  transcript: string | null;
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
    .upload(path, audio, { contentType: VOICEMAIL_CONTENT_TYPE, upsert: true });
  if (upload.error) {
    throw new Error(`voicemail store failed: ${upload.error.message}`);
  }

  // Words, if we can get them. Best effort by construction: every failure
  // path below leaves the voicemail exactly as it is without one — stored,
  // threaded, playable — so a model outage can never cost a customer message.
  const attempt = await transcribeVoicemail(env, db, {
    companyId: resolved.companyId,
    audio,
    seconds,
  });
  const transcript = attempt.text;

  // #367 depth (1): the greeting asked what the problem is and where. Break the
  // answer out into fields the crew can scan. Runs on the WORDS, not the audio,
  // so it costs a fraction of a cent on a transcript we already bought — and it
  // is strictly downstream of everything that makes the voicemail a voicemail.
  const intake = await extractVoicemailIntake(env, db, {
    companyId: resolved.companyId,
    transcript,
  });

  const { error: stampError } = await db
    .from("calls")
    .update({
      voicemail_path: path,
      voicemail_seconds: seconds,
      // Stamped whenever a model was reached, even when it found nothing, for
      // the same reason the transcript attempt is: otherwise the same reading
      // is bought again the next time anyone opens the call.
      ...(intake.reached
        ? { voicemail_intake_at: new Date().toISOString() }
        : {}),
      ...(intake.intake === null ? {} : { voicemail_intake: intake.intake }),
      // Record the attempt here too, or a recording that answered with nothing
      // is bought a second time the first time anyone plays it: the playback
      // backfill reads this column to decide, and would otherwise see a
      // recording that had never been tried. Only a run that reached a model
      // counts, for the same reason it does there.
      ...(attempt.reached
        ? { voicemail_transcript_attempted_at: new Date().toISOString() }
        : {}),
      ...(transcript === null ? {} : { voicemail_transcript: transcript }),
    })
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
    transcript,
  };
}

/**
 * Ask the model, with a second shape to fall back on.
 *
 * Both shapes ride ONE reservation. The monthly cap counts voicemails
 * transcribed, not how many encodings it took to read one, and reserving per
 * attempt halved the cap for every recording the first shape could not read.
 */
export interface TranscriptionOutcome {
  /**
   * Whether the recording actually got as far as a model. A refusal about the
   * COMPANY (opted out, over the monthly cap, no binding, a ledger the gate
   * could not read) spends nothing and says nothing about this recording, so a
   * caller must not record it as an attempt.
   */
  reached: boolean;
  /** The words, or null when there were none worth keeping. */
  text: string | null;
}

export async function runTranscription(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  audio: ArrayBuffer,
  /** Already-loaded settings, so the gate does not read them a second time. */
  settings?: CompanyAiSettings,
): Promise<TranscriptionOutcome> {
  // Base64 first: a five-minute recording is about a million array elements
  // otherwise, inside a 128 MB Worker already holding the raw buffer.
  const result = await runAiFeature(env, db, {
    companyId,
    spec: VOICEMAIL_TRANSCRIPT_FEATURE_SPEC,
    model: VOICEMAIL_TRANSCRIPT_MODEL,
    input: transcriptInput(Buffer.from(audio).toString("base64")),
    settings,
    fallback: {
      model: VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL,
      input: fallbackTranscriptInput(audio),
    },
    accept: (raw) => sanitizeTranscript(raw) !== null,
  });
  if (!result.ok) return { reached: result.reason === "model_error", text: null };
  return { reached: true, text: sanitizeTranscript(result.raw) };
}

/**
 * Speech-to-text over a stored voicemail, or null. Never throws: the caller is
 * mid-way through durably recording a customer's message, and no part of that
 * may depend on an AI call succeeding.
 *
 * Order matters and is the cost posture: the length gate and the company's
 * opt-in are both free, so they run BEFORE the reservation, and the
 * reservation runs before the model. A reservation that fails counts as over
 * cap (fail closed), because a broken ledger should cost a transcript, never
 * an unbounded bill.
 */
async function transcribeVoicemail(
  env: Env,
  db: SupabaseClient,
  args: { companyId: string; audio: ArrayBuffer; seconds: number },
): Promise<TranscriptionOutcome> {
  // The only check that is ours rather than the gate's: a recording of nothing,
  // or one that ran away, is not worth paying per audio minute for.
  if (!shouldTranscribe(args.seconds)) return { reached: false, text: null };
  return await runTranscription(env, db, args.companyId, args.audio);
}

export interface IntakeOutcome {
  /**
   * Whether a model was actually reached. A refusal about the COMPANY (opted
   * out, over cap, no binding) says nothing about THIS voicemail, so a caller
   * must not record it as an attempt — the same distinction transcription draws.
   */
  reached: boolean;
  /** The fields, or null when there were none worth keeping. */
  intake: VoicemailIntake | null;
}

/**
 * #367 depth (1): pull what the caller said out of the transcript.
 *
 * Never throws. By the time this runs the voicemail is stored, threaded and
 * playable, and the transcript — if there is one — is about to be written. There
 * is no outcome here that costs a customer a message; the worst case is the
 * product as it was before this feature, behind a greeting that asked better
 * questions.
 *
 * Order is the cost posture, same as transcription's: the free checks run before
 * the reservation, and the reservation before the model. No transcript, or one
 * too short to contain an answer, spends nothing.
 */
export async function extractVoicemailIntake(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    transcript: string | null;
    /** Already-loaded settings, so the gate does not read them a second time. */
    settings?: CompanyAiSettings;
  },
): Promise<IntakeOutcome> {
  if (!shouldExtractIntake(args.transcript)) return { reached: false, intake: null };
  const result = await runAiFeature(env, db, {
    companyId: args.companyId,
    spec: VOICEMAIL_INTAKE_FEATURE_SPEC,
    model: VOICEMAIL_INTAKE_MODEL,
    input: {
      messages: buildIntakeMessages(args.transcript as string),
      max_tokens: VOICEMAIL_INTAKE_MAX_OUTPUT_TOKENS,
    },
    settings: args.settings,
  });
  if (!result.ok) {
    return { reached: result.reason === "model_error", intake: null };
  }
  return { reached: true, intake: intakeFromRaw(result.raw) };
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
  voicemailTranscript: string | null = null,
): StoredVoicemail {
  return {
    companyId: resolved.companyId,
    phoneNumberId: resolved.phoneNumberId,
    callSessionId: sessionId,
    caller,
    seconds: voicemailSeconds ?? 0,
    // A replay reuses the transcript the first pass already paid for rather
    // than transcribing the same audio twice.
    transcript: voicemailTranscript,
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
    transcript?: string | null;
  },
  // #243: true when THIS call wrote the line, false when it was already
  // there. The caller needs the difference — a replay of this handler must
  // not tell an integration about the same voicemail twice, and the
  // already-exists guard below is the only place that knows.
): Promise<boolean> {
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
  if ((existing ?? []).length > 0) return false;

  const { error } = await db.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    actor_user_id: null,
    type: "call_completed",
    payload: {
      kind: "voicemail",
      // Written into the line itself so the thread can show the words with no
      // extra read. Omitted rather than null when absent, so an older line and
      // an untranscribed one look identical to every client.
      ...(input.transcript ? { transcript: input.transcript } : {}),
      call_session_id: input.callSessionId,
      outcome: "voicemail",
      voicemail_seconds: input.seconds,
      caller: input.caller,
    },
  });
  if (error) {
    throw new Error(`voicemail event insert failed: ${error.message}`);
  }
  return true;
}
