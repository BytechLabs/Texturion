import { describe, expect, it } from "vitest";

import {
  CARRIER_OPT_OUT_ERROR_CODE,
  GENERIC_SEND_FAILURE,
  sendFailureMessage,
} from "./send-failures";

describe("sendFailureMessage", () => {
  it("keeps the opt-out wording the clients already shipped", () => {
    expect(sendFailureMessage(CARRIER_OPT_OUT_ERROR_CODE)).toBe(
      "This customer opted out",
    );
  });

  it("explains the codes a small business actually hits", () => {
    expect(sendFailureMessage("40012")).toBe("That number isn't textable");
    expect(sendFailureMessage("40010")).toBe(
      "Your US texting registration isn't approved yet",
    );
    expect(sendFailureMessage("40003")).toBe("Carriers blocked this as spam");
  });

  it("separates a temporary carrier block from a permanent one", () => {
    // Worth rewording and retrying vs not worth trying again: the two must not
    // read the same, or the sentence is no better than "Not delivered".
    expect(sendFailureMessage("40002")).not.toBe(sendFailureMessage("40003"));
  });

  it("falls back rather than inventing a reason", () => {
    // An unknown code is exactly when a confident sentence would be a lie.
    expect(sendFailureMessage("99999")).toBe(GENERIC_SEND_FAILURE);
    expect(sendFailureMessage(null)).toBe(GENERIC_SEND_FAILURE);
    expect(sendFailureMessage(undefined)).toBe(GENERIC_SEND_FAILURE);
    expect(sendFailureMessage("")).toBe(GENERIC_SEND_FAILURE);
  });

  it("tolerates whitespace around a stored code", () => {
    expect(sendFailureMessage(" 40300 ")).toBe("This customer opted out");
  });
});
