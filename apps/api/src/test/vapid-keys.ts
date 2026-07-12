/**
 * Test-only VAPID pair generation.
 *
 * Produces a fresh, ephemeral P-256 pair in the exact standard Web Push
 * encoding the product decodes (`src/env.ts`, `src/notifications/webpush.ts`):
 *   - VAPID_PUBLIC_KEY  = base64url of the 65-byte uncompressed point
 *                         (0x04 || X || Y)
 *   - VAPID_PRIVATE_KEY = base64url of the 32-byte private scalar (d)
 *
 * Generated at runtime — deliberately NOT a committed literal. The repo is
 * public, and a static private key literal trips secret scanners (GitGuardian)
 * even though a test pair never touches production: production uses a separate
 * VAPID pair held only as a Cloudflare Worker secret (`npx web-push
 * generate-vapid-keys`, never in git). Randomising per process keeps the §8
 * crypto paths running for real in tests without shipping key material.
 */
import { generateKeyPairSync } from "node:crypto";

export interface VapidPair {
  /** base64url 65-byte uncompressed P-256 point (0x04 || X || Y). */
  publicKey: string;
  /** base64url 32-byte P-256 private scalar. */
  privateKey: string;
}

/** Generate a fresh standard-encoded VAPID key pair (synchronous). */
export function generateVapidPair(): VapidPair {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y || !jwk.d) {
    throw new Error("generated VAPID JWK is missing P-256 coordinates");
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("generated VAPID point is not a 32-byte P-256 coordinate");
  }
  const point = Buffer.concat([Buffer.from([0x04]), x, y]); // uncompressed
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}
