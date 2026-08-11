"use client";

import { useMutation } from "@tanstack/react-query";
import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { AiOutcome } from "./conversations";

/**
 * #507 Phase 1 — the crew member's post-call wrap-up, written down.
 *
 * WHOSE VOICE. Theirs, about a call that has ENDED. Never the call, never the
 * customer. D117 is why that line is the whole design: every interception
 * statute attaches to the moment the other party's contents are ACQUIRED, and
 * Canada's Criminal Code s.183 counts acquiring "the substance, meaning or
 * purport" — which is what a transcript is. One person speaking knowingly into
 * their own handset after hanging up engages none of it. No string in this
 * module, or in anything that renders it, may imply otherwise.
 *
 * WHY THE SERVER HANDS BACK TEXT INSTEAD OF POSTING THE NOTE. Every AI output
 * in this product is a suggestion somebody reads and edits first, and a note
 * written straight to a thread is not reviewable. So the transcript lands in
 * the note composer and goes out through the note route that already exists,
 * with its mentions, its permissions, its search and its push.
 *
 * BEST EFFORT, ALWAYS. Every failure below leaves the member exactly where they
 * were — the note composer, with a keyboard. Dictation is a shortcut, never a
 * precondition, which is why each reason gets a sentence of its own rather than
 * one shrug shared between them.
 */

/**
 * Longest dictation the server will transcribe, in seconds. Mirrors
 * CALL_WRAPUP_MAX_SECONDS (apps/api/src/ai/call-wrapup.ts) so the recorder can
 * stop itself rather than upload two minutes of pocket noise to be refused.
 * The server's copy is the one that counts.
 */
export const WRAP_UP_MAX_SECONDS = 120;

/**
 * Largest upload the server will read, in bytes. Mirrors
 * CALL_WRAPUP_MAX_BYTES. Checked here for the same reason: a recording this
 * side already knows will bounce should not cost anyone their upstream.
 */
export const WRAP_UP_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Why nothing came back. `too_long` is the route's own gate (seconds/bytes);
 * the rest come straight through from the shared AI gate's `AiRunFailure`
 * (apps/api/src/ai/run.ts) plus `unusable_output` for a model reply with no
 * words in it.
 */
export type WrapUpFailureReason =
  | "too_long"
  | "disabled"
  | "over_cap"
  | "model_error"
  | "unusable_output"
  | "unavailable"
  /** #581: the AI gate refuses a workspace that has stopped paying. */
  | "subscription_inactive";

/** POST /v1/conversations/:id/wrap-up-transcript — verbatim words, or a reason. */
export interface WrapUpTranscript {
  /** What they said, word for word. Null whenever `reason` is set. */
  text: string | null;
  reason?: WrapUpFailureReason;
}

/**
 * The one sentence the member sees when a dictation produces no words.
 *
 * Every branch says what happened AND leaves them holding the alternative that
 * always works — typing. "Something went wrong" would be the same sentence for
 * a workspace that switched the feature off, a month that ran out of budget,
 * and a model that fell over, and only one of those is worth trying again.
 *
 * #228: the sentences live in `i18n/sections/thread.ts` with the rest of the
 * dictation control. The CEILING is interpolated rather than written into each
 * translation — it mirrors the server's constant, and a French sentence
 * carrying its own "2" would be the first thing to go stale when that moves.
 */
export function wrapUpFailureMessage(
  reason: WrapUpFailureReason | undefined,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  switch (reason) {
    case "too_long":
      return t("thread.wrapUpTooLong", {
        minutes: WRAP_UP_MAX_SECONDS / 60,
      });
    case "disabled":
      return t("thread.wrapUpDisabled");
    case "subscription_inactive":
      // Billing, not breakage — so it must not say "try again", which is not
      // what fixes it. The same KEY every feature Lou refuses for this reason
      // reads, so the wording cannot drift between them (#581).
      return t("thread.louPausedForBilling");
    case "over_cap":
      return t("thread.wrapUpOverCap");
    case "model_error":
    case "unavailable":
      return t("thread.wrapUpUnreachable");
    case "unusable_output":
      return t("thread.wrapUpUnusable");
    default:
      return t("thread.wrapUpFailed");
  }
}

/**
 * What the member did with the words Lou wrote down (#431).
 *
 * The server declares all three outcomes for this feature — which it can only
 * do BECAUSE the transcript is handed over for review instead of posted. Kept
 * as a pure function for the same reason `draftOutcome` is: three clients
 * disagreeing about what "edited" means would make the counter useless.
 *
 * The judgment rests on two snapshots rather than on the transcript text,
 * because a wrap-up is appended to whatever was already typed. Comparing the
 * saved note against the transcript alone would call every note that had a
 * word of context in front of it "corrected", and would call a single typo fix
 * inside the dictation "thrown away".
 */
export function wrapUpOutcome(
  /** The composer contents either side of the insert; null when no dictation happened. */
  insert: { before: string; after: string } | null,
  /** The note body that actually saved. */
  saved: string,
): AiOutcome | null {
  if (insert === null) return null;
  const body = saved.trim();
  // Whitespace-insensitive on both ends: the composer trims on save, and a
  // trailing newline is not an edit anybody made.
  if (body === insert.after.trim()) return "used";
  // Back to exactly what was there beforehand — the dictation was removed, not
  // corrected. Covers the empty case too (a note saved with files only).
  if (body === insert.before.trim()) return "discarded";
  return "edited";
}

/**
 * The container the audio is uploaded in.
 *
 * MediaRecorder does not offer the same one everywhere: Chromium and Firefox
 * give WebM/Opus, Safari gives MP4/AAC. Both are in Whisper's accepted set, so
 * the recorder sends whichever the browser actually produced rather than
 * transcoding — and this names the part the server has no way to infer.
 */
export function wrapUpFileName(mimeType: string): string {
  if (mimeType.includes("mp4")) return "wrap-up.mp4";
  if (mimeType.includes("ogg")) return "wrap-up.ogg";
  return "wrap-up.webm";
}

/**
 * Send a dictation up and get the words back.
 *
 * A MUTATION, not a query: each call is a metered AI request a person asked for
 * by pressing a button, so it must never be refetched on focus, retried in the
 * background, or served from a cache. The text lives in the composer until it
 * is posted or deleted, and the audio is dropped the moment this resolves — it
 * is never stored here and never stored on the server.
 */
export function useWrapUpTranscript(conversationId: string) {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: ({ audio, seconds }: { audio: Blob; seconds: number }) => {
      const form = new FormData();
      form.append("audio", audio, wrapUpFileName(audio.type));
      // The client's CLAIM about duration. The server checks it against the
      // byte length, which is a fact, and refuses if either gate fails.
      form.append("seconds", String(seconds));
      return apiFetch<WrapUpTranscript>(
        `/v1/conversations/${conversationId}/wrap-up-transcript`,
        { method: "POST", companyId, formData: form },
      );
    },
  });
}
