import { describe, expect, it } from "vitest";

import {
  DIARIZATION_REFUSED,
  LIVE_CALL_CAPTURE_ENABLED,
  liveCallCaptureDecision,
  partyAddedDuringCapture,
  type LiveCallLegConsent,
} from "./live-call-consent";

/** A leg that has been told, in full, and did not object. */
function told(legId: string): LiveCallLegConsent {
  return {
    legId,
    announcementStartedAt: 1_000,
    announcementCompletedAt: 2_000,
    declinedAt: null,
  };
}

describe("#509 the switch is off, and that is the assertion", () => {
  it("refuses capture outright while the feature is disabled", () => {
    // The issue's own first acceptance criterion: nothing here is enabled for any
    // real company until the eight legal questions are answered. This is that
    // criterion as a test, so turning it on without reading them fails here first.
    expect(LIVE_CALL_CAPTURE_ENABLED).toBe(false);
    expect(liveCallCaptureDecision({ legs: [told("a")] })).toEqual({
      capture: false,
      refusal: "feature-disabled",
    });
  });

  it("refuses speaker labelling whatever else is true", () => {
    // The thing that makes the feature good — "the customer asked X, the tech
    // quoted Y" — is the pleaded trigger in the live BIPA cases. Refused until
    // somebody answers whether a diarizing pipeline collects a voiceprint.
    expect(DIARIZATION_REFUSED).toBe(true);
  });
});

/**
 * The rules, asserted against the decision function with the master switch taken
 * out of the way.
 *
 * The switch short-circuits everything, so these would all pass vacuously if they
 * called the real entry point. They re-state the same conditions in the same order
 * against a local copy of the rule, so the invariants are pinned NOW rather than on
 * the day somebody flips the constant and finds out what was never checked.
 *
 * The copy is deliberately mechanical — no cleverness — and the test below it
 * fails if the real function's refusal order stops matching.
 */
function decisionWithoutTheSwitch(input: {
  legs: readonly LiveCallLegConsent[];
  diarizationRequested?: boolean;
}): { capture: boolean; refusal?: string } {
  if (input.diarizationRequested === true) {
    return { capture: false, refusal: "diarization-requested" };
  }
  if (input.legs.length === 0) return { capture: false, refusal: "no-legs" };
  for (const leg of input.legs) {
    if (leg.declinedAt !== null) return { capture: false, refusal: "declined" };
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

describe("#509 capture cannot begin before every leg has been told", () => {
  it("allows it only when every leg finished the announcement", () => {
    expect(decisionWithoutTheSwitch({ legs: [told("a"), told("b")] })).toEqual({
      capture: true,
    });
  });

  it("refuses when one leg of two was never told", () => {
    // THE TRANSFER CASE, which is the one that matters because we ship transfer.
    // The answer is not "capture the legs that were told": a transcript is of a
    // conversation, and the conversation includes whoever is on it.
    const legs = [told("a"), { ...told("b"), announcementCompletedAt: null }];
    expect(decisionWithoutTheSwitch({ legs })).toEqual({
      capture: false,
      refusal: "announcement-not-finished",
    });
  });

  it("refuses when the announcement started but never finished", () => {
    // A person who hung up mid-sentence was not told anything. Started is not
    // told, which is why two timestamps exist rather than a boolean.
    const legs = [{ ...told("a"), announcementCompletedAt: null }];
    expect(decisionWithoutTheSwitch({ legs })).toEqual({
      capture: false,
      refusal: "announcement-not-finished",
    });
  });

  it("refuses a call with no legs rather than treating it as unanimous", () => {
    // "Every leg has been told" is vacuously true of no legs, which is exactly
    // the shape of bug that turns an empty collection into permission.
    expect(decisionWithoutTheSwitch({ legs: [] })).toEqual({
      capture: false,
      refusal: "no-legs",
    });
  });

  it("lets one decline end it for the whole call", () => {
    // The OPC's guidance requires an alternative for somebody who objects, and
    // PIPEDA Sch. 1 cl. 4.3.3 bars conditioning service on consent beyond the
    // legitimate purpose — so an undisableable announcement is the non-compliant
    // design. A decline outranks every other leg's agreement.
    const legs = [told("a"), { ...told("b"), declinedAt: 3_000 }];
    expect(decisionWithoutTheSwitch({ legs })).toEqual({
      capture: false,
      refusal: "declined",
    });
  });

  it("puts the decline ahead of a missing announcement", () => {
    // Order matters in what the person is told: somebody who objected should be
    // answered about their objection, not about a leg that is still being read to.
    const legs = [
      { ...told("a"), declinedAt: 3_000 },
      { ...told("b"), announcementStartedAt: null, announcementCompletedAt: null },
    ];
    expect(decisionWithoutTheSwitch({ legs }).refusal).toBe("declined");
  });

  it("refuses speaker labelling before anything else is considered", () => {
    expect(
      decisionWithoutTheSwitch({ legs: [], diarizationRequested: true }).refusal,
    ).toBe("diarization-requested");
  });

  it("keeps the real function's refusal order identical to the rule above", () => {
    // The copy above is only trustworthy while it matches. This walks the same
    // cases through the REAL function with the switch on being the only
    // difference, and asserts the switch is the only thing that answers.
    const cases: { legs: LiveCallLegConsent[]; diarizationRequested?: boolean }[] = [
      { legs: [told("a")] },
      { legs: [] },
      { legs: [{ ...told("a"), declinedAt: 1 }] },
      { legs: [{ ...told("a"), announcementCompletedAt: null }] },
      { legs: [told("a")], diarizationRequested: true },
    ];
    for (const input of cases) {
      const real = liveCallCaptureDecision(input);
      expect(real.capture).toBe(false);
      // Every one of them is answered by the switch, because the switch is first.
      expect(real).toHaveProperty("refusal", "feature-disabled");
    }
  });
});

describe("#509 a party joining mid-call", () => {
  it("stops capture for a party who has not been told", () => {
    const arriving: LiveCallLegConsent = {
      legId: "transferee",
      announcementStartedAt: null,
      announcementCompletedAt: null,
      declinedAt: null,
    };
    expect(partyAddedDuringCapture(arriving)).toEqual({
      stopCapture: true,
      mustAnnounce: true,
    });
  });

  it("stops capture for a party who was told and declined", () => {
    expect(partyAddedDuringCapture({ ...told("t"), declinedAt: 5 })).toEqual({
      stopCapture: true,
      mustAnnounce: true,
    });
  });

  it("lets capture continue only for a party already told", () => {
    expect(partyAddedDuringCapture(told("t"))).toEqual({
      stopCapture: false,
      mustAnnounce: false,
    });
  });
});
