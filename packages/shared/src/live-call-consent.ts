/**
 * #509 — whether a live call may be captured, decided in one place.
 *
 * ## THIS IS OFF, AND THE FLAG IS NOT A PREFERENCE
 *
 * {@link LIVE_CALL_CAPTURE_ENABLED} is `false` and must stay false until the
 * questions on #509 are answered by counsel. Eight of them, and two are not
 * "confirm our reading" — they are forks this code cannot resolve by itself:
 *
 *   - **Washington.** RCW 9.73.030(3) permits consent by announcement "in any
 *     reasonably effective manner: PROVIDED, That if the conversation is to be
 *     recorded that said announcement shall also be recorded". So either the
 *     announcement audio is retained, or the feature is geo-gated off there. Both
 *     are buildable; which one is correct is a legal answer, not a design taste.
 *   - **Voiceprints.** BIPA 740 ILCS 14/15(b) wants written notice and a written
 *     release before a biometric identifier is captured, and no phone prompt
 *     produces a written release from a homeowner with no account here. Whether a
 *     diarizing pipeline that persists no speaker template "collects a voiceprint"
 *     is being litigated now. Until that is answered, diarization is refused
 *     outright — see {@link DIARIZATION_REFUSED}.
 *
 * So this module is written to be correct and inert. Everything it decides is a
 * REFUSAL until each condition is positively met, which is the only safe default
 * for a thing whose failure mode is a criminal statute rather than a bad screen.
 *
 * ## Why the decision is here and not in the call machine
 *
 * The call machine is event-driven and stateful; this is a pure function over the
 * facts it has collected. Keeping them apart is what makes the invariant
 * testable: "capture cannot begin before every leg's announcement has completed"
 * is an assertion about this function, and #509's acceptance asks for exactly
 * that — asserted by a test, not by intent.
 */

/**
 * The master switch, and the answer is no.
 *
 * Not a config value and not an environment variable, deliberately: a constant a
 * reader can see is false, in the module that decides, is harder to flip by
 * accident than a dashboard toggle. Flipping it requires editing this file, which
 * puts the paragraphs above in front of whoever does.
 */
export const LIVE_CALL_CAPTURE_ENABLED = false;

/**
 * Speaker diarization is refused, whatever the vendor offers.
 *
 * Telnyx exposes `transcription_speaker_diarization`, and diarization is exactly
 * what a two-party summary wants — "the customer asked X, the tech quoted Y" is
 * worth more than an undifferentiated wall of text. It is also the pleaded trigger
 * in the live BIPA cases, so the thing that makes the feature good is the thing
 * that makes it dangerous, and that is the worst kind of tradeoff to leave to
 * whoever is holding the vendor's options page.
 */
export const DIARIZATION_REFUSED = true;

/** One leg of a call, and what it has been told. */
export interface LiveCallLegConsent {
  /** Stable id for the leg, so two legs cannot be mistaken for one. */
  legId: string;
  /**
   * When the announcement STARTED playing on this leg. Not sufficient on its own
   * — a person who hung up mid-sentence was not told anything.
   */
  announcementStartedAt: number | null;
  /**
   * When the announcement FINISHED, which is the only thing that counts.
   *
   * On Telnyx this is `call.speak.ended` for this leg, the same invariant the
   * greeting capture already rests on: capture starts on the event that says the
   * words were said, never on a flag somebody set beforehand.
   */
  announcementCompletedAt: number | null;
  /** When this party declined, if they did. A decline is permanent for the call. */
  declinedAt: number | null;
}

/** Why capture is refused. Every value is a reason a person could be told. */
export type LiveCallCaptureRefusal =
  | "feature-disabled"
  | "no-legs"
  | "announcement-not-started"
  | "announcement-not-finished"
  | "declined"
  | "diarization-requested";

export type LiveCallCaptureDecision =
  | { capture: true }
  | { capture: false; refusal: LiveCallCaptureRefusal };

/**
 * May this call be captured, right now, given what every leg has been told?
 *
 * ONE UN-ANNOUNCED LEG REFUSES THE WHOLE CALL. That is requirement 4 of #509 and
 * it is the case a transfer creates: we ship transfer, a transferee consented to
 * nothing, and no statute grandfathers a late joiner into a notice played before
 * they arrived. So the answer is not "capture the legs that were told" — a
 * transcript is of a conversation, and a conversation includes whoever is on it.
 *
 * A DECLINE ANYWHERE ENDS IT, for the whole call and for good. The OPC's guidance
 * on recording customer calls requires an alternative for somebody who objects,
 * and PIPEDA Sch. 1 cl. 4.3.3 bars conditioning service on consent beyond the
 * legitimate purpose — so an undisableable announcement is the non-compliant
 * design, which is the opposite of what an earlier decision here assumed.
 *
 * There is no "retroactive" branch. *Javier v. Assurance IQ* holds that
 * retroactive consent does not cure §631(a), so a call whose announcement finishes
 * late does not become capturable back to its beginning — the opening is simply
 * un-summarised, and #509 accepts that in requirement 5.
 */
export function liveCallCaptureDecision(input: {
  legs: readonly LiveCallLegConsent[];
  /** True when the caller asked for per-speaker labelling. Refused regardless. */
  diarizationRequested?: boolean;
}): LiveCallCaptureDecision {
  if (!LIVE_CALL_CAPTURE_ENABLED) {
    return { capture: false, refusal: "feature-disabled" };
  }
  if (DIARIZATION_REFUSED && input.diarizationRequested === true) {
    return { capture: false, refusal: "diarization-requested" };
  }
  if (input.legs.length === 0) {
    return { capture: false, refusal: "no-legs" };
  }
  for (const leg of input.legs) {
    if (leg.declinedAt !== null) {
      return { capture: false, refusal: "declined" };
    }
  }
  for (const leg of input.legs) {
    if (leg.announcementStartedAt === null) {
      return { capture: false, refusal: "announcement-not-started" };
    }
    if (leg.announcementCompletedAt === null) {
      return { capture: false, refusal: "announcement-not-finished" };
    }
  }
  return { capture: true };
}

/**
 * Whether adding a party must stop capture that is already running.
 *
 * The honest answer to a transfer is one of two things, and #509 allows either:
 * re-announce to everybody, or stop. This says which applies given whether the
 * new leg has been through the announcement. It never returns "carry on".
 */
export function partyAddedDuringCapture(newLeg: LiveCallLegConsent): {
  /** Capture must stop until the condition below is met. */
  stopCapture: boolean;
  /** The new party has to be told before capture may resume. */
  mustAnnounce: boolean;
} {
  const told =
    newLeg.announcementCompletedAt !== null && newLeg.declinedAt === null;
  return { stopCapture: !told, mustAnnounce: !told };
}
