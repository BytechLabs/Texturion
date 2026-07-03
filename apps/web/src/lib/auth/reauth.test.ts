import { describe, expect, it } from "vitest";

import {
  isEmailChanged,
  isValidNonce,
  needsReauth,
  planPasswordSubmit,
} from "./reauth";

describe("needsReauth (D18 §1.6 stale-session detection)", () => {
  it("detects the reauthentication_needed error code", () => {
    expect(needsReauth({ code: "reauthentication_needed" })).toBe(true);
    expect(needsReauth({ code: "reauthentication_required" })).toBe(true);
  });

  it("falls back to a message sniff for SDKs without the code", () => {
    expect(
      needsReauth({ message: "A reauthentication is required to proceed." }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(needsReauth({ code: "weak_password" })).toBe(false);
    expect(needsReauth({ message: "Password is too weak." })).toBe(false);
    expect(needsReauth(null)).toBe(false);
    expect(needsReauth(undefined)).toBe(false);
    expect(needsReauth("some string")).toBe(false);
  });
});

describe("isValidNonce (6-digit reauth code)", () => {
  it("accepts exactly six digits, trimming whitespace", () => {
    expect(isValidNonce("123456")).toBe(true);
    expect(isValidNonce("  654321 ")).toBe(true);
  });

  it("rejects the wrong length or non-digits", () => {
    expect(isValidNonce("12345")).toBe(false);
    expect(isValidNonce("1234567")).toBe(false);
    expect(isValidNonce("12a456")).toBe(false);
    expect(isValidNonce("")).toBe(false);
  });
});

describe("planPasswordSubmit (D18 §1.6 one-or-two step)", () => {
  it("plans a single update when no reauth is required (fresh session)", () => {
    expect(planPasswordSubmit({ reauthRequested: false, nonce: "" })).toEqual({
      kind: "update",
    });
  });

  it("plans reauth-then-update with a valid nonce", () => {
    expect(
      planPasswordSubmit({ reauthRequested: true, nonce: " 123456 " }),
    ).toEqual({ kind: "reauth_then_update", nonce: "123456" });
  });

  it("returns null (form error) when a required nonce is missing or malformed", () => {
    expect(planPasswordSubmit({ reauthRequested: true, nonce: "" })).toBeNull();
    expect(
      planPasswordSubmit({ reauthRequested: true, nonce: "12ab" }),
    ).toBeNull();
  });
});

describe("isEmailChanged (D18 §1.5 no-op guard)", () => {
  it("is true only when the normalized address differs", () => {
    expect(isEmailChanged("sam@old.com", "new@company.com")).toBe(true);
    expect(isEmailChanged("sam@old.com", "SAM@OLD.COM")).toBe(false);
    expect(isEmailChanged("sam@old.com", "  sam@old.com ")).toBe(false);
  });

  it("treats an empty new email as unchanged (no pointless confirm email)", () => {
    expect(isEmailChanged("sam@old.com", "")).toBe(false);
    expect(isEmailChanged("sam@old.com", "   ")).toBe(false);
  });

  it("allows setting an email when none exists yet", () => {
    expect(isEmailChanged(null, "sam@company.com")).toBe(true);
    expect(isEmailChanged(undefined, "sam@company.com")).toBe(true);
  });
});
