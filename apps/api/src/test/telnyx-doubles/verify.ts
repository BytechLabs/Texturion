/**
 * TEST-ONLY stand-in for the telnyx track's `src/telnyx/verify.ts`
 * (cross-track contract) — see ./provisioning.ts for why this exists.
 *
 * Unlike the other doubles this one implements the REAL contract algorithm,
 * because the webhook suites must exercise genuine signature verification
 * with real Ed25519 keypairs (D13): Ed25519 over `${timestamp}|${raw_body}`
 * from the telnyx-signature-ed25519 + telnyx-timestamp headers, WebCrypto
 * subtle.verify, 5-minute tolerance, public key from env.TELNYX_PUBLIC_KEY
 * (base64 raw key). Returns the parsed JSON payload, or null on ANY failure.
 */
import type { Env } from "../../env";

const TOLERANCE_SECONDS = 5 * 60;

function fromBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

export async function verifyTelnyxWebhook(
  env: Env,
  request: Request,
): Promise<object | null> {
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return null;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return null;
  if (Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) return null;

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return null;
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromBase64(env.TELNYX_PUBLIC_KEY),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      fromBase64(signature),
      new TextEncoder().encode(`${timestamp}|${rawBody}`),
    );
    if (!valid) return null;
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as object)
      : null;
  } catch {
    return null;
  }
}
