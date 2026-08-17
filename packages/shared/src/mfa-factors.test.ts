import { describe, expect, it } from "vitest";

import {
  MFA_SUMMARY_KEYS,
  NAMED_MFA_FACTOR_TYPES,
  hasAuthenticatorFactor,
  hasPasskeyFactor,
  mfaSummaryKey,
  missingMfaFactorTypes,
} from "./mfa-factors";

/**
 * #473 — the rule three clients render, pinned once.
 *
 * What these hold is not the branching (which is obvious) but the two answers
 * that are easy to get wrong under pressure: an unknown factor type must not
 * read as "no second factor", and holding both must offer neither.
 */
describe("mfaSummaryKey", () => {
  it("names a passkey as a passkey rather than as an authenticator app", () => {
    // The wrong answer here sends somebody looking for six digits that do not
    // exist on any of their devices.
    expect(mfaSummaryKey(["webauthn"])).toBe("settingsMore.tfaPasskeyOn");
  });

  it("names an authenticator app as an authenticator app", () => {
    expect(mfaSummaryKey(["totp"])).toBe("settingsMore.tfaAuthenticatorOn");
  });

  it("names both when both are held, in either order", () => {
    expect(mfaSummaryKey(["webauthn", "totp"])).toBe("settingsMore.tfaBothOn");
    expect(mfaSummaryKey(["totp", "webauthn"])).toBe("settingsMore.tfaBothOn");
  });

  it("falls back to a true general sentence for a type it cannot name", () => {
    // `phone` is a type the platform supports and this product does not enrol.
    // The dangerous failure would be rendering "off" for somebody protected.
    expect(mfaSummaryKey(["phone"])).toBe("settingsMore.tfaOn");
    expect(mfaSummaryKey([null])).toBe("settingsMore.tfaOn");
  });

  it("only ever returns a key every client is asserted to hold", () => {
    for (const input of [["webauthn"], ["totp"], ["webauthn", "totp"], ["x"]]) {
      expect(MFA_SUMMARY_KEYS).toContain(mfaSummaryKey(input));
    }
  });
});

describe("missingMfaFactorTypes", () => {
  it("offers the other kind to somebody holding one", () => {
    expect(missingMfaFactorTypes(["totp"])).toEqual(["webauthn"]);
    expect(missingMfaFactorTypes(["webauthn"])).toEqual(["totp"]);
  });

  it("offers nothing to somebody holding both", () => {
    expect(missingMfaFactorTypes(["totp", "webauthn"])).toEqual([]);
  });

  it("offers nothing to somebody with no factors, who gets the pitch instead", () => {
    // Not the same state: with nothing enrolled the card explains what setup
    // involves. "Add a passkey" beside no explanation is a button with no
    // context.
    expect(missingMfaFactorTypes([])).toEqual([]);
  });

  it("offers both to somebody holding only a kind this product does not enrol", () => {
    expect(missingMfaFactorTypes(["phone"]).sort()).toEqual(["totp", "webauthn"]);
  });
});

describe("the predicates", () => {
  it("agree with the summary they feed", () => {
    expect(hasPasskeyFactor(["webauthn"])).toBe(true);
    expect(hasPasskeyFactor(["totp"])).toBe(false);
    expect(hasAuthenticatorFactor(["totp"])).toBe(true);
    expect(hasAuthenticatorFactor(["webauthn"])).toBe(false);
  });

  it("names exactly the two kinds this product enrols", () => {
    // Set equality in both directions. A kind added here without the copy and
    // the enrolment path behind it is a button that opens nothing; a kind
    // enrolled without being listed here renders the fallback sentence.
    expect([...NAMED_MFA_FACTOR_TYPES].sort()).toEqual(["totp", "webauthn"]);
  });
});
