/**
 * #241 — the failure taxonomy three clients and the send path share.
 *
 * `CarrierFailureTest.kt` and `CarrierFailureTests.swift` assert this same
 * table against their hand-ports, because copied logic drifts silently and a
 * drift here means one app offering a retry button that another withholds —
 * for a block only the customer can lift.
 */
import { describe, expect, it } from "vitest";

import {
  classifySendFailure,
  failureReasonOf,
  isRetryableFailure,
} from "./carrier-failure";

describe("classifySendFailure", () => {
  it("classifies the opt-out, which is the one with a legal meaning", () => {
    expect(classifySendFailure("40300")).toBe("opt_out");
  });

  it("collapses codes that we treat identically", () => {
    // Four Telnyx codes mean "their phone did not take it". That is one reason
    // here, because nothing we do differs between them.
    for (const code of ["40001", "40012", "40310", "40004", "40006", "40008"]) {
      expect(classifySendFailure(code), code).toBe("unreachable");
    }
    for (const code of ["40011", "40016", "40018", "40318"]) {
      expect(classifySendFailure(code), code).toBe("rate_limited");
    }
  });

  it("is unknown for a code we have not classified", () => {
    // Never a soft default. An unrecognised failure acquiring the behaviour of
    // a known one is how a bug becomes a policy.
    expect(classifySendFailure("99999")).toBe("unknown");
    expect(classifySendFailure("")).toBe("unknown");
    expect(classifySendFailure(null)).toBe("unknown");
    expect(classifySendFailure(undefined)).toBe("unknown");
  });

  it("NEVER guesses opt_out", () => {
    // The one that would do real harm: a STOP can only be lifted by the
    // customer, so a wrongly-inferred opt-out takes their number out of
    // service and nobody here can put it back.
    for (const code of ["99999", "40999", "abc", " ", "4030", "403000"]) {
      expect(classifySendFailure(code), code).not.toBe("opt_out");
    }
  });

  it("trims, because a stray space is a transport artefact not a new code", () => {
    expect(classifySendFailure(" 40300 ")).toBe("opt_out");
  });
});

describe("failureReasonOf", () => {
  it("prefers the server's classification", () => {
    expect(failureReasonOf("spam_blocked", "40300")).toBe("spam_blocked");
  });

  it("falls back to the code for rows written before the column existed", () => {
    // Those rows sit on somebody's phone for months (#339). A client that only
    // understood the new field would show the wrong affordance on every one.
    expect(failureReasonOf(null, "40300")).toBe("opt_out");
    expect(failureReasonOf(undefined, "40011")).toBe("rate_limited");
  });

  it("ignores a server value it does not recognise, rather than crashing (D44)", () => {
    expect(failureReasonOf("something_new", "40300")).toBe("opt_out");
    expect(failureReasonOf("something_new", null)).toBe("unknown");
  });
});

describe("isRetryableFailure", () => {
  it("never offers a retry for an opt-out", () => {
    expect(isRetryableFailure("opt_out")).toBe(false);
  });

  it("offers one for everything else", () => {
    for (const reason of [
      "unreachable",
      "content_blocked",
      "spam_blocked",
      "rate_limited",
      "expired",
      "not_provisioned",
      "unknown",
    ] as const) {
      expect(isRetryableFailure(reason), reason).toBe(true);
    }
  });
});
