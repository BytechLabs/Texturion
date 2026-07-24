import { describe, expect, it } from "vitest";

import {
  isApplePrivateRelay,
  isOAuthOnly,
  signInMethods,
  type IdentityLike,
} from "./identities";

const email: IdentityLike = { provider: "email" };
const google: IdentityLike = { provider: "google" };
const apple: IdentityLike = { provider: "apple" };

describe("signInMethods (D18 §1.8 linked-methods list)", () => {
  it("always returns Google, Apple, Password in order", () => {
    expect(signInMethods([]).map((m) => m.method)).toEqual([
      "google",
      "apple",
      "password",
    ]);
  });

  it("marks present providers linked and absent ones not", () => {
    const state = signInMethods([email, google]);
    expect(state).toEqual([
      { method: "google", linked: true },
      { method: "apple", linked: false },
      { method: "password", linked: true },
    ]);
  });

  it("handles a null/undefined identities array", () => {
    expect(signInMethods(null).every((m) => !m.linked)).toBe(true);
    expect(signInMethods(undefined).every((m) => !m.linked)).toBe(true);
  });
});

describe("isOAuthOnly (D18 §1.6/§1.8 'Set a password' gate)", () => {
  it("is true when there is no email/password identity", () => {
    expect(isOAuthOnly([apple])).toBe(true);
    expect(isOAuthOnly([google, apple])).toBe(true);
    expect(isOAuthOnly([])).toBe(true);
    expect(isOAuthOnly(null)).toBe(true);
  });

  it("is false once a password identity exists", () => {
    expect(isOAuthOnly([email])).toBe(false);
    expect(isOAuthOnly([google, email])).toBe(false);
  });
});

describe("isApplePrivateRelay (D18 §1.8)", () => {
  it("detects the Apple relay domain, case-insensitively", () => {
    expect(isApplePrivateRelay("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelay("ABC@PrivateRelay.AppleID.com")).toBe(true);
  });

  it("is false for real inboxes and empty input", () => {
    expect(isApplePrivateRelay("sam@company.com")).toBe(false);
    expect(isApplePrivateRelay("sam@appleid.com")).toBe(false);
    expect(isApplePrivateRelay(null)).toBe(false);
    expect(isApplePrivateRelay(undefined)).toBe(false);
    expect(isApplePrivateRelay("not-an-email")).toBe(false);
  });
});

describe("a password set after an OAuth signup (founder report)", () => {
  // Supabase creates an 'email' identity only when the account SIGNED UP with
  // a password. Setting one later on a Google account creates none, so the
  // identities array says google-only forever — confirmed in production.
  const googleOnly = [{ provider: "google" }];

  it("reports the password as linked when the server says there is one", () => {
    const state = signInMethods(googleOnly, true);
    expect(state.find((m) => m.method === "password")?.linked).toBe(true);
    // Google stays identity-driven, where the array IS accurate.
    expect(state.find((m) => m.method === "google")?.linked).toBe(true);
    expect(state.find((m) => m.method === "apple")?.linked).toBe(false);
  });

  it("offers Change password, not Set a password, once one exists", () => {
    expect(isOAuthOnly(googleOnly, true)).toBe(false);
    expect(isOAuthOnly(googleOnly, false)).toBe(true);
  });

  it("falls back to the identity check when the server did not say", () => {
    expect(signInMethods(googleOnly).find((m) => m.method === "password")?.linked)
      .toBe(false);
    expect(isOAuthOnly(googleOnly)).toBe(true);
    expect(isOAuthOnly([{ provider: "email" }])).toBe(false);
  });
});
