/**
 * #336 — what the call permalink SAYS, kept pure.
 *
 * Split from the component for the same reason `composer-banner.ts` is split
 * from its renderer: these are the two judgement calls on the page, both have
 * a state that reads as a bug if it is got wrong, and neither needs React or
 * an API client to decide. Importing the component into a test drags the
 * public-env validation in with it, which is a poor reason to leave the
 * decisions untested.
 */
import type { Translate } from "@/i18n/provider";
import type { CallDetail as CallDetailRow } from "@/lib/api/types";

/**
 * What happened, in the words an owner would use.
 *
 * #228: the reader's `t` is a PARAMETER rather than a hook call, which is what
 * keeps these two decisions pure — the whole reason they live outside the
 * component. A test hands them `makeTranslate("en")` and asserts the same
 * sentences it always did.
 */
export function outcomeLine(call: CallDetailRow, t: Translate): string {
  if (call.outcome === null) return t("shell.outcomeInProgress");
  if (call.direction === "outbound") {
    return call.outcome === "answered"
      ? t("shell.outcomeAnswered")
      : t("shell.outcomeNoAnswer");
  }
  switch (call.outcome) {
    case "answered":
      return t("shell.outcomeAnswered");
    case "voicemail":
      return t("shell.outcomeLeftVoicemail");
    default:
      return t("shell.outcomeMissed");
  }
}

/**
 * The honest transcript state.
 *
 * The pipeline is best-effort by design — transcription can be off, over the
 * monthly cap, or simply fail — so "no words" is normal rather than
 * exceptional, and the reader needs to tell "we tried and there was nothing"
 * from "we never tried". An empty panel would read as a bug in both cases.
 * *Applying: G10 — system states must be precise.*
 */
export function transcriptState(
  call: CallDetailRow,
  t: Translate,
): { text: string; muted: boolean } {
  if (call.voicemail_transcript) {
    return { text: call.voicemail_transcript, muted: false };
  }
  if (!call.has_voicemail) {
    // The outcome and the recording can genuinely disagree: a call can end as
    // `voicemail` and the recording still fail to store. Saying "no voicemail
    // was left" there contradicts the line directly above it, which reads as a
    // broken page rather than a missing file — so the two cases get different
    // words. Caught by looking at the rendered page, not by reading the code.
    return call.outcome === "voicemail"
      ? {
          text: t("shell.transcriptRecordingLost"),
          muted: true,
        }
      : { text: t("shell.transcriptNoVoicemail"), muted: true };
  }
  if (call.voicemail_transcript_attempted_at) {
    return {
      text: t("shell.transcriptNoWords"),
      muted: true,
    };
  }
  return {
    text: t("shell.transcriptNotYet"),
    muted: true,
  };
}
