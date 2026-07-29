/**
 * #336 — the call permalink's two judgement calls.
 *
 * The page itself is layout; these two functions decide what it SAYS, and both
 * have a state that reads as a bug if it is got wrong. The transcript pipeline
 * is best-effort by design — transcription can be off, over the monthly cap,
 * or simply fail — so "no words" is a normal outcome, and a reader has to be
 * able to tell "we tried and there was nothing" from "we never tried".
 */
import { describe, expect, it } from "vitest";

import { outcomeLine, transcriptState } from "./call-detail-copy";
import type { CallDetail } from "@/lib/api/types";

const base = {
  outcome: "voicemail",
  direction: "inbound",
  has_voicemail: true,
  voicemail_transcript: null,
  voicemail_transcript_attempted_at: null,
} as unknown as CallDetail;

const call = (over: Partial<CallDetail>) => ({ ...base, ...over }) as CallDetail;

describe("what the call detail says happened", () => {
  it("names an inbound outcome in the words an owner would use", () => {
    expect(outcomeLine(call({ outcome: "voicemail" }))).toBe("Left a voicemail");
    expect(outcomeLine(call({ outcome: "missed" }))).toBe("Missed");
    expect(outcomeLine(call({ outcome: "answered" }))).toBe("Answered");
  });

  it("does not call an unanswered OUTBOUND call 'missed'", () => {
    // "Missed" is what happens to you; an outbound call nobody picked up is a
    // different fact about a different person.
    expect(outcomeLine(call({ direction: "outbound", outcome: "missed" }))).toBe(
      "No answer",
    );
  });

  it("says a live call is live rather than guessing at an outcome", () => {
    expect(outcomeLine(call({ outcome: null }))).toBe("In progress");
  });
});

describe("the honest transcript state", () => {
  it("shows the words when there are words", () => {
    const state = transcriptState(call({ voicemail_transcript: "Leaking tap." }));
    expect(state).toEqual({ text: "Leaking tap.", muted: false });
  });

  it("distinguishes 'we tried and heard nothing' from 'we never tried'", () => {
    // The distinction the reader needs, and the one an empty panel destroys.
    const tried = transcriptState(
      call({ voicemail_transcript_attempted_at: "2026-07-29T10:00:00Z" }),
    );
    const never = transcriptState(call({}));
    expect(tried.text).toContain("couldn't make out");
    expect(never.text).toContain("hasn't been written down yet");
    expect(tried.text).not.toBe(never.text);
  });

  it("never implies a voicemail exists when none was left", () => {
    const state = transcriptState(call({ has_voicemail: false, outcome: "missed" }));
    expect(state.text).toBe("No voicemail was left on this call.");
  });

  it("does not contradict the outcome when the recording failed to save", () => {
    // A call CAN end as `voicemail` with no stored recording. Saying "no
    // voicemail was left" there contradicts the outcome line directly above
    // it, which reads as a broken page rather than a missing file.
    const state = transcriptState(call({ has_voicemail: false, outcome: "voicemail" }));
    expect(state.text).toContain("recording didn't save");
    expect(state.text).not.toContain("No voicemail was left");
  });

  it("says the recording still plays when the words failed", () => {
    // A failed transcript is not a reason to hide the audio — the audio is the
    // thing we actually have.
    const state = transcriptState(
      call({ voicemail_transcript_attempted_at: "2026-07-29T10:00:00Z" }),
    );
    expect(state.text).toContain("still plays");
  });
});
