import type { CallerClass, ControlClass } from "@loonext/rig-protocol";

import type { Env } from "./env";

/**
 * The edge holds only SHA-256 digests of tokens. A presented token is hashed
 * and compared with every configured digest, with no early exit, so neither a
 * near miss nor which class matched shows in timing. Tokens are 256-bit
 * random values, so an unsalted digest is not a brute-force target.
 */

type TokenClass =
  | { namespace: "caller"; name: CallerClass }
  | { namespace: "control"; name: ControlClass };

/** One secret per class. `satisfies` breaks the build when the protocol adds one. */
const CALLER_TOKENS = {
  "rig-api": "TOKEN_SHA256_RIG_API",
  robot: "TOKEN_SHA256_ROBOT",
  diag: "TOKEN_SHA256_DIAG",
  admin: "TOKEN_SHA256_ADMIN",
} as const satisfies Record<CallerClass, keyof Env>;

const CONTROL_TOKENS = {
  rig: "TOKEN_SHA256_RIG",
  triage: "TOKEN_SHA256_TRIAGE",
} as const satisfies Record<ControlClass, keyof Env>;

const HEX_DIGEST = /^[0-9a-f]{64}$/;

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function digestBytes(hex: string | undefined): Uint8Array | null {
  const value = hex?.trim().toLowerCase();
  if (!value || !HEX_DIGEST.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function equalDigests(a: Uint8Array, b: Uint8Array): boolean {
  return crypto.subtle.timingSafeEqual(a, b);
}

/** The bearer token on a request, or null. */
export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return match ? match[1] : null;
}

/**
 * The class a token belongs to, across both namespaces at once. A token whose
 * digest is configured for two classes matches neither: that is a
 * provisioning mistake, and guessing which one was meant would widen a token.
 */
async function classOf(env: Env, token: string | null): Promise<TokenClass | null> {
  if (!token) return null;
  const presented = await sha256(token);
  const candidates: TokenClass[] = [
    ...(Object.keys(CALLER_TOKENS) as CallerClass[]).map(
      (name) => ({ namespace: "caller", name }) as const,
    ),
    ...(Object.keys(CONTROL_TOKENS) as ControlClass[]).map(
      (name) => ({ namespace: "control", name }) as const,
    ),
  ];
  let found: TokenClass | null = null;
  let matches = 0;
  for (const candidate of candidates) {
    const secret =
      candidate.namespace === "caller"
        ? env[CALLER_TOKENS[candidate.name]]
        : env[CONTROL_TOKENS[candidate.name]];
    const expected = digestBytes(secret);
    if (expected && equalDigests(presented, expected)) {
      found = candidate;
      matches += 1;
    }
  }
  return matches === 1 ? found : null;
}

/** The guard caller class for a `/g` request, or null. */
export async function callerClassOf(env: Env, request: Request): Promise<CallerClass | null> {
  const found = await classOf(env, bearer(request));
  return found?.namespace === "caller" ? found.name : null;
}

/** True when the request carries a token of exactly this control class. */
export async function hasControlClass(
  env: Env,
  request: Request,
  wanted: ControlClass,
): Promise<boolean> {
  const found = await classOf(env, bearer(request));
  return found?.namespace === "control" && found.name === wanted;
}

/** True when a secret path segment hashes to the configured digest. */
export async function secretSegmentMatches(
  segment: string,
  digestHex: string | undefined,
): Promise<boolean> {
  const expected = digestBytes(digestHex);
  if (!expected || segment.length === 0) return false;
  return equalDigests(await sha256(segment), expected);
}
