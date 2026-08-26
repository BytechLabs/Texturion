import { describe, expect, it } from "vitest";

import {
  createCalendarOauthProof,
  openCalendarCredential,
  sealCalendarCredential,
  type CalendarCredentialContext,
  type CalendarEncryptionKeyring,
} from "./crypto";

function encodedKey(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const CONTEXT: CalendarCredentialContext = {
  companyId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  provider: "google",
  purpose: "refresh_token",
};

const KEYRING: CalendarEncryptionKeyring = {
  activeVersion: "v2",
  keys: { v1: encodedKey(1), v2: encodedKey(2) },
};

describe("calendar credential envelope", () => {
  it("round-trips without storing plaintext and uses the active version", async () => {
    const sealed = await sealCalendarCredential("refresh-secret", CONTEXT, KEYRING);
    expect(sealed.keyVersion).toBe("v2");
    expect(sealed.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed.ciphertext).not.toContain("refresh-secret");
    await expect(openCalendarCredential(sealed, CONTEXT, KEYRING)).resolves.toBe(
      "refresh-secret",
    );
  });

  it("reads an old key version after rotation", async () => {
    const beforeRotation: CalendarEncryptionKeyring = {
      activeVersion: "v1",
      keys: KEYRING.keys,
    };
    const sealed = await sealCalendarCredential("old-refresh", CONTEXT, beforeRotation);
    await expect(openCalendarCredential(sealed, CONTEXT, KEYRING)).resolves.toBe(
      "old-refresh",
    );
  });

  it("refuses verifier/token swaps", async () => {
    const verifierContext: CalendarCredentialContext = {
      ...CONTEXT,
      purpose: "oauth_pkce_verifier",
    };
    const refresh = await sealCalendarCredential(
      "refresh-secret",
      CONTEXT,
      KEYRING,
    );
    const verifier = await sealCalendarCredential(
      "pkce-secret",
      verifierContext,
      KEYRING,
    );

    await expect(
      openCalendarCredential(refresh, verifierContext, KEYRING),
    ).rejects.toThrow();
    await expect(
      openCalendarCredential(verifier, CONTEXT, KEYRING),
    ).rejects.toThrow();

  });

  it("fails authentication when the row context is swapped", async () => {
    const sealed = await sealCalendarCredential("refresh-secret", CONTEXT, KEYRING);
    await expect(
      openCalendarCredential(
        sealed,
        { ...CONTEXT, userId: "33333333-3333-4333-8333-333333333333" },
        KEYRING,
      ),
    ).rejects.toThrow();
    await expect(
      openCalendarCredential(sealed, { ...CONTEXT, provider: "microsoft" }, KEYRING),
    ).rejects.toThrow();
  });

  it("fails closed for a missing or malformed key version", async () => {
    const sealed = await sealCalendarCredential("refresh-secret", CONTEXT, KEYRING);
    await expect(
      openCalendarCredential({ ...sealed, keyVersion: "retired" }, CONTEXT, KEYRING),
    ).rejects.toThrow(/unavailable/);
    await expect(
      sealCalendarCredential("x", CONTEXT, {
        activeVersion: "bad",
        keys: { bad: "c2hvcnQ" },
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("calendar OAuth proof", () => {
  it("creates independent opaque state and a valid S256 PKCE pair", async () => {
    const proof = await createCalendarOauthProof();
    expect(proof.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.state).not.toBe(proof.verifier);
    expect(proof.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(proof.verifier),
    );
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const expected = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(proof.challenge).toBe(expected);
  });
});
