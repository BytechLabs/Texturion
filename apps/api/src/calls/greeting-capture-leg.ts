/**
 * #309 — the greeting-capture LEG: what happens once the owner picks up.
 *
 * Three events, in order, all on the one outbound leg the capture route dialed:
 *
 *   call.answered        → speak the prompt
 *   call.speak.ended     → record_start, with the beep
 *   call.recording.saved → fetch the audio, store it, insert the row, hang up
 *
 * The whole transaction is the call. Nothing is written before the recording
 * lands, so an owner who changes their mind and hangs up leaves nothing behind
 * — no half-made greeting in their list, nothing to sweep.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is speak a confirmation afterwards. It
 * would be the friendlier ending, and it is also how this grows a loop: the
 * confirmation ends with its own `call.speak.ended`, which is precisely the
 * event that starts a recording. The owner's confirmation is the greeting
 * appearing in the app they started the call from.
 *
 * Every failure below leaves the workspace exactly as it was. A capture call
 * that goes wrong costs an owner one wasted minute; it can never cost them the
 * greeting they already had, and it can never leave a line pointing at audio
 * that does not exist — which is the silence #309 says must never happen.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../env";
import { deleteTelnyxRecording } from "../messaging/inbound-ring";
import { telnyxRequest, isDefiniteRefusal } from "../telnyx/client";

import {
  GREETING_CAPTURE_MAX_SECONDS,
  GREETING_CAPTURE_MIN_SECONDS,
  GREETING_CAPTURE_SILENCE_SECS,
  greetingCapturePrompt,
  parseGreetingCaptureState,
  type GreetingCaptureTag,
} from "./greeting-capture";

/** The private bucket recorded greetings live in (20260804360000). */
/**
 * Exported because the workspace purge and the orphan sweep both have to name
 * this bucket, and a second copy of the string is how one of them ends up
 * sweeping a bucket that no longer exists (#581 — it was in neither).
 */
export const GREETING_BUCKET = "voicemail-greetings";

/** Telnyx records to mp3, and the bucket accepts it. */
const CAPTURE_MIME = "audio/mpeg";

/** 2 MB, the bucket's own limit. Two minutes of speech is far under it; this
 *  refuses the degenerate case before it reaches storage. */
const MAX_GREETING_BYTES = 2 * 1024 * 1024;

export interface CaptureLegPayload {
  call_control_id?: string;
  call_session_id?: string;
  client_state?: string | null;
  recording_urls?: { mp3?: string; wav?: string };
  recording_started_at?: string;
  recording_ended_at?: string;
}

/** A 4xx on a leg that already ended is the routine race of telephony. */
async function onLiveLeg(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await telnyxRequest(env, { method: "POST", path, body });
  } catch (cause) {
    // #616: see isDefiniteRefusal — a 429 is about our request rate, so it
    // takes the same path as a 503 rather than being swallowed as "done".
    if (isDefiniteRefusal(cause)) return;
    throw cause;
  }
}

/**
 * Handle one event on a greeting-capture leg. Returns false when the tag did
 * not verify, which the caller treats as "this is not a capture leg" and hands
 * back to the ordinary routing rules — where an unauthorized outgoing PSTN leg
 * is hung up rather than served.
 */
export async function handleGreetingCaptureEvent(
  env: Env,
  db: SupabaseClient,
  eventType: string,
  payload: CaptureLegPayload,
): Promise<boolean> {
  const tag = await parseGreetingCaptureState(
    env,
    payload.client_state,
    Date.now(),
  );
  if (!tag) return false;

  const ccid = payload.call_control_id;
  if (!ccid) return true; // verified but uncontrollable — nothing to do

  if (eventType === "call.answered") {
    await speakPrompt(env, db, ccid, tag, payload.client_state ?? "");
    return true;
  }

  if (eventType === "call.speak.ended") {
    // The beep the owner records after. `timeout_secs` is the silence that
    // ends it for somebody who finishes talking and waits rather than hanging
    // up — both endings produce the same call.recording.saved.
    await onLiveLeg(env, `/v2/calls/${ccid}/actions/record_start`, {
      format: "mp3",
      channels: "single",
      play_beep: true,
      max_length: GREETING_CAPTURE_MAX_SECONDS,
      timeout_secs: GREETING_CAPTURE_SILENCE_SECS,
      client_state: payload.client_state,
    });
    return true;
  }

  if (eventType === "call.recording.saved") {
    await storeCapturedGreeting(env, db, tag, payload);
    // Whichever way the recording ended, this leg is finished. A hangup on a
    // leg the owner already dropped 4xxs, which is the expected case.
    await onLiveLeg(env, `/v2/calls/${ccid}/actions/hangup`, {});
    return true;
  }

  // call.initiated / call.hangup / anything else: verified as ours, nothing to
  // do. An abandoned capture call is a no-op by design.
  return true;
}

/** Speak the prompt, naming the business so the owner knows what picked up. */
async function speakPrompt(
  env: Env,
  db: SupabaseClient,
  ccid: string,
  tag: GreetingCaptureTag,
  clientState: string,
): Promise<void> {
  const { data } = await db
    .from("companies")
    .select("name")
    .eq("id", tag.companyId)
    .limit(1);
  const companyName = (data?.[0] as { name?: string } | undefined)?.name ?? "";
  await onLiveLeg(env, `/v2/calls/${ccid}/actions/speak`, {
    payload: greetingCapturePrompt(companyName),
    voice: "female",
    language: "en-US",
    client_state: clientState,
  });
}

/**
 * Fetch Telnyx's copy inside its presigned window, put it in our bucket, and
 * insert the row — then delete the Telnyx copy.
 *
 * The object goes in BEFORE the row, the same order and for the same reason as
 * the upload route: an orphaned object costs a few kilobytes and is swept,
 * while a row pointing at bytes that never landed shows an owner a greeting in
 * their list and plays their callers the robot.
 */
async function storeCapturedGreeting(
  env: Env,
  db: SupabaseClient,
  tag: GreetingCaptureTag,
  payload: CaptureLegPayload,
): Promise<void> {
  const sessionId = payload.call_session_id;
  const url = payload.recording_urls?.mp3;
  if (!sessionId || !url) return;

  const startMs = Date.parse(payload.recording_started_at ?? "");
  const endMs = Date.parse(payload.recording_ended_at ?? "");
  const seconds =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 1000))
      : 0;
  if (seconds < GREETING_CAPTURE_MIN_SECONDS) {
    // A hangup on the beep. Nothing worth keeping, and nothing to tell the
    // owner on a call that is already over — their list simply does not change.
    await deleteTelnyxRecording(env, sessionId);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    // An expired presigned URL (a replay past the window) or a Telnyx storage
    // fault. Unrecoverable, and there is no retry that helps: log, take the
    // Telnyx copy out anyway, and leave the workspace as it was.
    console.error(
      `greeting capture fetch failed for ${sessionId}: HTTP ${response.status}`,
    );
    await deleteTelnyxRecording(env, sessionId);
    return;
  }
  const audio = await response.arrayBuffer();
  if (audio.byteLength === 0 || audio.byteLength > MAX_GREETING_BYTES) {
    console.error(
      `greeting capture rejected for ${sessionId}: ${audio.byteLength} bytes`,
    );
    await deleteTelnyxRecording(env, sessionId);
    return;
  }

  const objectPath = `${tag.companyId}/${crypto.randomUUID()}.mp3`;
  const upload = await db.storage
    .from(GREETING_BUCKET)
    .upload(objectPath, audio, { contentType: CAPTURE_MIME, upsert: false });
  if (upload.error) {
    throw new Error(
      `greeting capture upload failed (${objectPath}): ${upload.error.message}`,
    );
  }

  const { error } = await db.from("voicemail_greetings").insert({
    company_id: tag.companyId,
    name: tag.name,
    storage_path: `${GREETING_BUCKET}/${objectPath}`,
    duration_ms: Math.min(seconds, GREETING_CAPTURE_MAX_SECONDS) * 1000,
    mime_type: CAPTURE_MIME,
    byte_size: audio.byteLength,
    // No `created_by`: the leg is a webhook, and the member who asked for the
    // call is recorded on the audit row the route wrote before dialing.
  });

  if (error) {
    // Take the bytes back out — an object nothing references is waste, and
    // this is the one place that knows it exists.
    const removal = await db.storage.from(GREETING_BUCKET).remove([objectPath]);
    if (removal.error) {
      console.error(
        `greeting capture object orphaned (${objectPath}): ${removal.error.message}`,
      );
    }
    if (error.code === "23505") {
      // The owner recorded over a name they already have. On a call that has
      // already ended there is nobody to ask, and overwriting a greeting they
      // did not ask us to touch is the worse answer — a second recording named
      // "After hours" must never silently replace the first.
      Sentry.captureMessage(
        `#309 capture call discarded: "${tag.name}" already exists in ${tag.companyId}`,
        "info",
      );
      await deleteTelnyxRecording(env, sessionId);
      return;
    }
    throw new Error(`greeting capture insert failed: ${error.message}`);
  }

  // Only once the row is durable. Until then the Telnyx copy is the only
  // surviving version, and a replay after a throw above needs to be able to
  // fetch it again.
  await deleteTelnyxRecording(env, sessionId);
}
