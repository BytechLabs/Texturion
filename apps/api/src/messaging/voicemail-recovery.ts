import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { captureException } from "../observability/capture";
import { deleteTelnyxRecording } from "./inbound-ring";
import { handleVoicemailSaved } from "./voice-webhook";

const RECOVERY_WINDOW_MS = 24 * 60 * 60_000;
const RECOVERY_LEASE_MS = 55 * 60_000;
const RECOVERY_BATCH = 25;

function recordingTime(value: unknown): string | null {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function deferVoicemail(
  db: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const sessionId = payload.call_session_id;
  if (typeof sessionId !== "string") throw new TypeError("voicemail recovery requires a call session");
  const { data, error } = await db.rpc("api_defer_voicemail", {
    p_session_id: sessionId,
    p_started_at: recordingTime(payload.recording_started_at),
    p_ended_at: recordingTime(payload.recording_ended_at),
  });
  if (error) throw new Error(`voicemail handoff failed: ${error.message}`);
  if (data !== true) throw new Error("voicemail handoff could not find the call");
}

export async function sweepPendingVoicemails(env: Env, db: SupabaseClient): Promise<void> {
  const now = Date.now();
  const attemptedAt = new Date(now).toISOString();
  const leaseCutoff = new Date(now - RECOVERY_LEASE_MS).toISOString();
  const due = `voicemail_pending_attempted_at.is.null,voicemail_pending_attempted_at.lte.${leaseCutoff}`;
  const { data, error } = await db.from("calls")
    .select("id,company_id,call_session_id,voicemail_path,voicemail_pending_since,voicemail_pending_started_at,voicemail_pending_ended_at")
    .not("voicemail_pending_since", "is", null)
    .is("deleted_at", null)
    .is("voicemail_deleted_at", null)
    .or(due)
    .order("voicemail_pending_attempted_at", { ascending: true, nullsFirst: true })
    .order("voicemail_pending_since")
    .limit(RECOVERY_BATCH);
  if (error) throw new Error(`pending voicemail lookup failed: ${error.message}`);

  const cutoff = now - RECOVERY_WINDOW_MS;
  for (const row of data ?? []) {
    const { data: claimed, error: claimError } = await db.from("calls")
      .update({ voicemail_pending_attempted_at: attemptedAt })
      .eq("company_id", row.company_id)
      .eq("id", row.id)
      .eq("voicemail_pending_since", row.voicemail_pending_since)
      .is("deleted_at", null)
      .is("voicemail_deleted_at", null)
      .or(due)
      .select("id");
    if (claimError) throw new Error(`voicemail recovery claim failed: ${claimError.message}`);
    if (!claimed?.length) continue;

    const expired = Date.parse(row.voicemail_pending_since) <= cutoff;
    let recovered = false;
    if (!expired || row.voicemail_path) {
      try {
        await handleVoicemailSaved(env, db, {
          call_session_id: row.call_session_id,
          recording_started_at: row.voicemail_pending_started_at,
          recording_ended_at: row.voicemail_pending_ended_at,
        });
        recovered = true;
      } catch {
        if (!expired) continue;
      }
    }

    if (!recovered) await deleteTelnyxRecording(env, row.call_session_id);
    const { data: cleared, error: clearError } = await db.from("calls")
      .update({
        voicemail_pending_since: null,
        voicemail_pending_started_at: null,
        voicemail_pending_ended_at: null,
        voicemail_pending_attempted_at: null,
      })
      .eq("company_id", row.company_id)
      .eq("id", row.id)
      .eq("voicemail_pending_since", row.voicemail_pending_since)
      .eq("voicemail_pending_attempted_at", attemptedAt)
      .select("id");
    if (clearError) throw new Error(`voicemail recovery stamp failed: ${clearError.message}`);
    if (!recovered && cleared?.length) {
      await captureException(env, "voicemail recovery exhausted", {
        source: "cron",
        job: "job:sweep-stale-calls",
        extra: { call_session_id: row.call_session_id },
      });
    }
  }
}
