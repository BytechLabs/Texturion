import { describe, expect, it } from "vitest";

import { callLooksSpam } from "./call-screening";

describe("callLooksSpam", () => {
  it("is clean for the result every production call carries", () => {
    // 134 of 134 stored results on 2026-11-10 had this shape.
    expect(
      callLooksSpam('{"action":"flag_calls","reputation":0,"shaken_stir_attestation":"A"}'),
    ).toBe(false);
    expect(
      callLooksSpam('{"action":"flag_calls","reputation":null,"shaken_stir_attestation":"C"}'),
    ).toBe(false);
  });

  it("flags Telnyx's spam_likely verdict in each documented form", () => {
    expect(callLooksSpam("spam_likely")).toBe(true);
    expect(callLooksSpam('"spam_likely"')).toBe(true);
    expect(callLooksSpam('{"action":"flag_calls","result":"spam_likely"}')).toBe(true);
    expect(callLooksSpam('{"spam_likely":true}')).toBe(true);
    expect(callLooksSpam(null, "SPAM LIKELY")).toBe(true);
  });

  it("never reads the screening mode as a verdict", () => {
    expect(callLooksSpam('{"action":"spam_likely"}')).toBe(false);
    expect(callLooksSpam("flag_calls")).toBe(false);
  });

  it("treats anything unrecognised as clean", () => {
    for (const value of [null, undefined, "", "not json {", "[]", "fraud_risk", '{"spam_likely":false}']) {
      expect(callLooksSpam(value)).toBe(false);
    }
    expect(callLooksSpam(null, "Sam Plumbing")).toBe(false);
  });
});
