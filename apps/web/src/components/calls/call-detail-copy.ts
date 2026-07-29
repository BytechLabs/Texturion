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
import type { CallDetail as CallDetailRow } from "@/lib/api/types";

/** What happened, in the words an owner would use. */
export function outcomeLine(call: CallDetailRow): string {
  if (call.outcome === null) return "In progress";
  if (call.direction === "outbound") {
    return call.outcome === "answered" ? "Answered" : "No answer";
  }
  switch (call.outcome) {
    case "answered":
      return "Answered";
    case "voicemail":
      return "Left a voicemail";
    default:
      return "Missed";
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
export function transcriptState(call: CallDetailRow): { text: string; muted: boolean } {
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
          text: "They started leaving a voicemail, but the recording didn't save.",
          muted: true,
        }
      : { text: "No voicemail was left on this call.", muted: true };
  }
  if (call.voicemail_transcript_attempted_at) {
    return {
      text: "We couldn't make out any words in this one. The recording still plays.",
      muted: true,
    };
  }
  return {
    text: "This voicemail hasn't been written down yet. Playing it will do that.",
    muted: true,
  };
}
