import { EDGE_PATHS, MEDIA_BUCKETS } from "@loonext/rig-protocol";

import { uplink, type Env } from "./env";
import { empty, safeContentType } from "./http";

/**
 * `/m/...`: Telnyx fetching MMS media and recorded greetings from the rig's
 * storage, which is not on the internet.
 *
 * The app swaps its storage prefix for the edge's media path (telnyxMediaUrl
 * in apps/api/src/telnyx/client.ts), so a fetch looks like
 * `/m/object/sign/<bucket>/<path>?token=<jwt>`. Only the rig's storage holds
 * the token's signing key, so the edge checks the claims it can read without
 * it: the token names this object and has not expired. The rig's storage
 * verifies the signature.
 */

const SIGNED_PREFIX = `${EDGE_PATHS.mediaPrefix}object/sign/`;
const JWT = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;
const ALLOWED_QUERY = new Set(["token", "download"]);

function base64UrlJson(segment: string): unknown {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** A decoded path segment that could step out of its bucket or split in two. */
function unsafeSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return true;
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || segment[i] === "/" || segment[i] === "\\") return true;
  }
  return false;
}

/**
 * The storage path the rig should fetch (what follows `/storage/v1`), or null
 * when the request is not a live signed URL for a relayed bucket.
 */
export function signedMediaPath(url: URL, nowMs: number = Date.now()): string | null {
  if (!url.pathname.startsWith(SIGNED_PREFIX)) return null;
  const encoded = url.pathname.slice(SIGNED_PREFIX.length);

  let segments: string[];
  try {
    segments = encoded.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length < 2 || segments.some(unsafeSegment)) return null;
  if (!(MEDIA_BUCKETS as readonly string[]).includes(segments[0])) return null;

  for (const key of url.searchParams.keys()) if (!ALLOWED_QUERY.has(key)) return null;
  if (url.searchParams.getAll("token").length !== 1) return null;
  const token = url.searchParams.get("token") ?? "";
  const match = JWT.exec(token);
  if (!match) return null;
  const claims = base64UrlJson(match[1]) as { url?: unknown; exp?: unknown } | null;
  if (!claims || claims.url !== segments.join("/")) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return null;

  return `/object/sign/${encoded}${url.search}`;
}

export async function relayMedia(env: Env, request: Request): Promise<Response> {
  const path = signedMediaPath(new URL(request.url));
  if (!path) return empty(404);
  const outcome = await uplink(env).fetchMedia(path);
  if (outcome.status !== 200 || !outcome.body) return empty(outcome.status);
  return new Response(request.method === "HEAD" ? null : outcome.body, {
    status: 200,
    headers: {
      "content-type": safeContentType(outcome.contentType ?? null),
      "content-length": String(outcome.body.byteLength),
    },
  });
}
