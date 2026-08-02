/**
 * [#296] Which page produced this signup.
 *
 * Six trade landing pages and three comparison pages are a real investment
 * with no feedback loop: nothing today can say whether `/compare` or
 * `/for/plumbers` produces a customer. #296's ask 5 — per-competitor
 * alternative pages — is explicitly gated on this answer, so this is the
 * measurement that decides whether more of that work is worth doing.
 *
 * # FIRST touch, which is the opposite of the referral capture next door
 *
 * `lib/referral/capture.ts` takes LAST touch, correctly: a reward should
 * follow the link somebody actually arrived through most recently.
 *
 * This takes FIRST touch, and the reason is the question being asked. A
 * visitor reads `/compare/heymarket`, thinks about it for a week, comes back
 * to `/pricing` and signs up. Last touch credits `/pricing` — which every
 * signup passes through, so it would credit `/pricing` for everything and
 * teach us nothing. The page that *started* it is the one whose value is in
 * question.
 *
 * # Nothing here may carry personal data
 *
 * The values below travel into telemetry and onto the company row, so the
 * allow-list is closed rather than open: five campaign keys that describe an
 * ad, and nothing that could describe a person. `?q=`, `?email=` and every
 * other parameter stay cut. This is why `stripQueryAndHash` can keep cutting
 * everything else — the exception is enumerated, not inferred.
 */

/**
 * The only query parameters allowed to survive scrubbing.
 *
 * Standard campaign keys plus the two click ids the ad platforms set. None can
 * carry a name, an address or a message body; all are attacker-controlled, so
 * every one is length-capped and character-filtered below.
 */
export const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

export type AttributionParam = (typeof ATTRIBUTION_PARAMS)[number];

/** What a first touch records. Every field is optional and bounded. */
export interface FirstTouch {
  /** The marketing path they landed on, query stripped. */
  landing_path: string;
  /** The referring HOST only — never the full URL, which can carry a query. */
  referrer_host: string | null;
  /** Allow-listed campaign parameters, sanitised. */
  params: Partial<Record<AttributionParam, string>>;
  /** When the touch happened, ISO. */
  at: string;
}

/** Longest value we will store. Campaign names are short; anything longer is not one. */
export const ATTRIBUTION_VALUE_MAX = 64;
/** Longest landing path. Marketing routes are short and deliberately so. */
export const ATTRIBUTION_PATH_MAX = 128;

/**
 * Keep a value only if it is plausibly a campaign token.
 *
 * Letters, digits and the punctuation ad tooling actually emits. A value that
 * needs anything else is not a campaign name, and refusing it is cheaper than
 * reasoning about what it might be.
 */
export function sanitizeAttributionValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > ATTRIBUTION_VALUE_MAX) return null;
  return /^[A-Za-z0-9._~%+-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * A landing path we are willing to store: absolute, query-free, bounded.
 *
 * Returns null for anything else — including a full URL, which would carry the
 * query string this module exists to keep out.
 */
export function sanitizeLandingPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const cut = trimmed.search(/[?#]/);
  const path = cut === -1 ? trimmed : trimmed.slice(0, cut);
  if (path.length === 0 || path.length > ATTRIBUTION_PATH_MAX) return null;
  // Path segments only. A marketing route never contains anything else, and a
  // path that does is not one of ours.
  return /^\/[A-Za-z0-9\-._~/]*$/.test(path) ? path : null;
}

/**
 * The referring HOST, or null.
 *
 * Host only, deliberately: a full referrer URL can carry a search query from
 * whatever site sent them, which is exactly the class of data the scrubber
 * cuts everywhere else.
 */
export function referrerHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.length > 0 && host.length <= ATTRIBUTION_VALUE_MAX ? host : null;
  } catch {
    return null;
  }
}

/** Pull the allow-listed parameters out of a query string, sanitised. */
export function attributionParams(
  search: string | URLSearchParams,
): Partial<Record<AttributionParam, string>> {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const out: Partial<Record<AttributionParam, string>> = {};
  for (const key of ATTRIBUTION_PARAMS) {
    const value = sanitizeAttributionValue(params.get(key));
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Is this touch worth recording at all?
 *
 * A bare landing on `/` with no referrer and no campaign says nothing, and
 * storing it would make "direct" the most successful page we have.
 */
export function isMeaningfulTouch(touch: FirstTouch): boolean {
  return (
    Object.keys(touch.params).length > 0 ||
    touch.referrer_host !== null ||
    touch.landing_path !== "/"
  );
}
