/**
 * Encryption and OAuth proof primitives for calendar connectors (#245).
 *
 * Provider refresh tokens are bearer credentials with long-lived access to a
 * member's schedule. They are encrypted before Postgres sees them, and the
 * AES-GCM additional data binds a ciphertext to the workspace, member and
 * provider row it belongs to so copied/swapped database values do not decrypt.
 */

import { generateToken, hashToken } from "../public-links/tokens";

export type CalendarProviderName = "google" | "microsoft";
export type CalendarCredentialPurpose =
  | "refresh_token"
  | "oauth_pkce_verifier";

export interface CalendarCredentialContext {
  companyId: string;
  userId: string;
  provider: CalendarProviderName;
  /** Domain-separates long-lived provider authority from one-use OAuth proof. */
  purpose: CalendarCredentialPurpose;
}

export interface CalendarEncryptionKeyring {
  /** Version used for new writes; old versions remain readable for rotation. */
  activeVersion: string;
  /** Base64url-encoded 32-byte AES-256 keys, keyed by version. */
  keys: Readonly<Record<string, string>>;
}

export interface SealedCalendarCredential {
  ciphertext: string;
  iv: string;
  keyVersion: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("calendar encryption value is not base64url");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("calendar encryption value is not valid base64url");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function additionalData(context: CalendarCredentialContext): Uint8Array {
  return encoder.encode(
    `calendar-credential\0v2\0${context.purpose}\0${context.companyId}\0${context.userId}\0${context.provider}`,
  );
}

async function importVersion(
  keyring: CalendarEncryptionKeyring,
  version: string,
): Promise<CryptoKey> {
  const encoded = keyring.keys[version];
  if (!encoded) throw new Error(`calendar encryption key version ${version} is unavailable`);
  const raw = base64urlDecode(encoded);
  if (raw.byteLength !== 32) {
    throw new Error(`calendar encryption key version ${version} must be 32 bytes`);
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt a provider refresh token or a short-lived PKCE verifier. */
export async function sealCalendarCredential(
  plaintext: string,
  context: CalendarCredentialContext,
  keyring: CalendarEncryptionKeyring,
): Promise<SealedCalendarCredential> {
  if (plaintext.length === 0) throw new Error("calendar credential cannot be empty");
  const key = await importVersion(keyring, keyring.activeVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(context) },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: base64urlEncode(new Uint8Array(ciphertext)),
    iv: base64urlEncode(iv),
    keyVersion: keyring.activeVersion,
  };
}

/** Decrypt using the version written beside the row (rotation-safe). */
export async function openCalendarCredential(
  sealed: SealedCalendarCredential,
  context: CalendarCredentialContext,
  keyring: CalendarEncryptionKeyring,
): Promise<string> {
  const iv = base64urlDecode(sealed.iv);
  if (iv.byteLength !== 12) throw new Error("calendar credential IV must be 12 bytes");
  const ciphertext = base64urlDecode(sealed.ciphertext);
  const key = await importVersion(keyring, sealed.keyVersion);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(context) },
    key,
    ciphertext,
  );
  return decoder.decode(plaintext);
}

export interface CalendarOauthProof {
  /** Sent to the provider and returned to the callback; never persisted. */
  state: string;
  /** The only form of state persisted. */
  stateHash: string;
  /** Encrypted before persistence and consumed exactly once. */
  verifier: string;
  challenge: string;
}

/** Mint a state token and RFC 7636 S256 PKCE pair. */
export async function createCalendarOauthProof(): Promise<CalendarOauthProof> {
  const state = generateToken();
  const verifier = generateToken();
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return {
    state,
    stateHash: await hashToken(state),
    verifier,
    challenge: base64urlEncode(new Uint8Array(challengeBytes)),
  };
}
