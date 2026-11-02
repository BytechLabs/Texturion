/**
 * One ops email per fingerprint per hour (#652).
 *
 * Two paths mail the operator: `opsAlert` as the problem happens, and the
 * PostHog alert webhook when PostHog opens or reopens the issue. They share one
 * fingerprint, so whichever speaks first owns the hour and the other stays
 * quiet. A storm of one problem is one mail, not hundreds.
 *
 * The slot is a Cache API entry that expires on its own. That is per data
 * centre, so two edges can each send once; the failure is one extra mail. It
 * also fails open: a cache that cannot be read or written sends the mail,
 * because a lost alert is worse than a repeated one.
 */

/** How long a fingerprint stays quiet after its mail goes out. */
export const OPS_EMAIL_WINDOW_SECONDS = 60 * 60;

/** Never fetched; the cache only needs a well-formed URL to key on. */
const KEY_ORIGIN = "https://ops-email-throttle.invalid/";

/** The part of the Cache API this module uses, so tests can stand one in. */
export interface ThrottleCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

function defaultCache(): ThrottleCache | undefined {
  const store = (globalThis as { caches?: { default?: ThrottleCache } }).caches;
  return store?.default;
}

/** A fixed-length key, so a long or odd fingerprint cannot break the URL. */
async function slotRequest(fingerprint: string): Promise<Request> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprint),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(`${KEY_ORIGIN}${hex}`);
}

/**
 * Take the hour's slot for `fingerprint`. True means send the mail; false means
 * one already went out inside the window.
 */
export async function claimOpsEmailSlot(
  fingerprint: string,
  cache: ThrottleCache | undefined = defaultCache(),
): Promise<boolean> {
  if (!cache) return true;
  try {
    const request = await slotRequest(fingerprint);
    if (await cache.match(request)) return false;
    await cache.put(
      request,
      new Response("1", {
        headers: { "cache-control": `public, max-age=${OPS_EMAIL_WINDOW_SECONDS}` },
      }),
    );
    return true;
  } catch (cause) {
    console.error(
      "ops email throttle unavailable, sending anyway:",
      cause instanceof Error ? cause.message : String(cause),
    );
    return true;
  }
}

/** Hand the slot back after a send that failed, so a retry is not swallowed. */
export async function releaseOpsEmailSlot(
  fingerprint: string,
  cache: ThrottleCache | undefined = defaultCache(),
): Promise<void> {
  if (!cache) return;
  try {
    await cache.delete(await slotRequest(fingerprint));
  } catch {
    // The slot expires within the hour on its own.
  }
}
