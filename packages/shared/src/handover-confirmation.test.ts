import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "./error-codes";
import {
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
  HANDOVER_CONFIRM_WHERE,
  handoverConfirmationKind,
  isHandoverCode,
} from "./handover-confirmation";

describe("which prompt to show (#537)", () => {
  it("sends somebody with an authenticator to their app", () => {
    expect(handoverConfirmationKind("mfa_challenge_required")).toBe(
      "authenticator",
    );
  });

  it("sends somebody without one to their inbox", () => {
    expect(handoverConfirmationKind("confirmation_code_required")).toBe("email");
  });

  it("asks for nothing when the refusal was about something else", () => {
    // THE CASE THAT MATTERS. A handover is also refused when a transfer is
    // already in flight, or when the caller is not the owner. A client that
    // treated every refusal as "ask for a code" would prompt for a code that
    // could never help, and hide the real reason behind it.
    for (const code of ["conflict", "forbidden", "validation_failed", "not_found"]) {
      expect(handoverConfirmationKind(code), code).toBeNull();
    }
    expect(handoverConfirmationKind(null)).toBeNull();
    expect(handoverConfirmationKind(undefined)).toBeNull();
  });

  it("keys on codes the API actually has", () => {
    // A prompt keyed on a code that no longer exists is a prompt that never
    // shows. Checked against the real union rather than a copy of it.
    expect(ERROR_CODES).toContain("mfa_challenge_required");
    expect(ERROR_CODES).toContain("confirmation_code_required");
  });
});

describe("what the dialog says (#537)", () => {
  it("tells each kind where to look, in different words", () => {
    // "Enter your code" is useless to somebody who does not know which code, and
    // the two live in completely different places.
    expect(HANDOVER_CONFIRM_WHERE.authenticator).toContain("authenticator app");
    expect(HANDOVER_CONFIRM_WHERE.email).toContain("emailed");
    expect(HANDOVER_CONFIRM_WHERE.authenticator).not.toBe(
      HANDOVER_CONFIRM_WHERE.email,
    );
  });

  it("mentions the email code's limits where somebody can act on them", () => {
    // Ten minutes and one use are the two things that turn "it didn't work" into
    // "ask for another", which is the next thing they need to do.
    expect(HANDOVER_CONFIRM_WHERE.email).toContain("once");
    expect(HANDOVER_CONFIRM_WHERE.email).toContain("ten minutes");
  });

  it("never promises to resend an authenticator code", () => {
    // There is nothing to resend — the app generates them. A Resend button on
    // that path would imply we could send one, which we cannot.
    expect(HANDOVER_CONFIRM_RESEND.toLowerCase()).toContain("again");
    expect(HANDOVER_CONFIRM_WHERE.authenticator).not.toContain("again");
  });

  it("says one thing when a code is refused, inventing no distinction", () => {
    // The server deliberately answers the same way for wrong, expired, spent and
    // out-of-attempts, because telling somebody which would tell an attacker
    // whether they had the right digits. The client must not undo that.
    for (const leak of ["expired", "already", "attempts", "wrong"]) {
      expect(HANDOVER_CONFIRM_REJECTED.toLowerCase(), leak).not.toContain(leak);
    }
  });
});

describe("isHandoverCode (#537)", () => {
  it("accepts six digits", () => {
    expect(isHandoverCode("123456")).toBe(true);
    expect(isHandoverCode("000000")).toBe(true);
  });

  it("tolerates the whitespace a pasted code arrives with", () => {
    expect(isHandoverCode("  123456 ")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "12345", "1234567", "12345a", "abcdef", "12 34 56"]) {
      expect(isHandoverCode(bad), bad).toBe(false);
    }
  });
});
