import type { Env } from "../env";

/**
 * Telnyx webhook signature verification (SPEC §7 step 1, §10; cross-track
 * contract): Ed25519 over the exact bytes of `"{timestamp}|{raw_body}"`,
 * signature from the `telnyx-signature-ed25519` header (base64), timestamp
 * from `telnyx-timestamp` (unix seconds), public key = TELNYX_PUBLIC_KEY
 * (base64 of the 32-byte raw Ed25519 key from the Telnyx portal), verified
 * with WebCrypto. Timestamps more than 5 minutes from now (either direction)
 * are rejected.
 *
 * Returns the parsed JSON payload object on success; `null` on ANY failure —
 * missing headers, malformed base64, skewed timestamp, bad signature, or a
 * body that is not a JSON object. Callers treat null as 400 (SPEC §7).
 */

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The public key never changes within an isolate; importing it once per key
 * string keeps the hot webhook path free of repeated key imports.
 */
const importedKeys = new Map<string, CryptoKey>();

async function importPublicKey(base64Key: string): Promise<CryptoKey | null> {
  const cached = importedKeys.get(base64Key);
  if (cached) return cached;

  const raw = decodeBase64(base64Key);
  // Raw Ed25519 public keys are exactly 32 bytes; anything else is misconfig.
  if (!raw || raw.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      raw as unknown as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    importedKeys.set(base64Key, key);
    return key;
  } catch {
    return null;
  }
}

export async function verifyTelnyxWebhook(
  env: Env,
  request: Request,
): Promise<object | null> {
  const signatureHeader = request.headers.get("telnyx-signature-ed25519");
  const timestampHeader = request.headers.get("telnyx-timestamp");
  if (!signatureHeader || !timestampHeader) return null;

  // Strict unix-seconds parse; 5-minute tolerance both directions (SPEC §10).
  if (!/^\d{1,12}$/.test(timestampHeader)) return null;
  const timestamp = Number(timestampHeader);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return null;
  }

  const signature = decodeBase64(signatureHeader);
  if (!signature || signature.length === 0) return null;

  const key = await importPublicKey(env.TELNYX_PUBLIC_KEY);
  if (!key) return null;

  // Clone so the caller can still consume the body afterwards.
  let rawBody: string;
  try {
    rawBody = await request.clone().text();
  } catch {
    return null;
  }

  const signedPayload = new TextEncoder().encode(
    `${timestampHeader}|${rawBody}`,
  );

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature as unknown as ArrayBuffer,
      signedPayload as unknown as ArrayBuffer,
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as object;
    }
    return null;
  } catch {
    return null;
  }
}
