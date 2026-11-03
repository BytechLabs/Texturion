/**
 * PII scrubbing for browser and web-server telemetry (SPEC §10, D8): message
 * bodies, contact names, email addresses and phone numbers never reach
 * PostHog.
 *
 * Twin of the API Worker's scrubber, apps/api/src/observability/scrub.ts:
 * same patterns, same markers. `scrub.test.ts` compares the pattern SOURCE of
 * both files and the token prefixes, because the two drifted twice while a
 * comment said they agreed. Do not replace those tests with a claim about them.
 */

/**
 * E.164-shaped digit runs (SPEC §10): optional '+' (or its URL-encoded form
 * %2B, so numbers inside URLs are caught too), optional country code 1, then
 * 10 to 15 digits, bounded so we do not fire inside longer identifiers (Stripe
 * and Telnyx ids): no digit or letter immediately before, no digit
 * immediately after.
 *
 * Those bounds do not protect a UUID. Its last group follows a '-', so a group
 * that opens with ten or more digits (about 0.9% of random v4 UUIDs) read as a
 * phone number. UUID_PATTERN is tried first, in the same pass, and kept whole.
 */
const PHONE_PATTERN = /(?<![0-9A-Za-z])(?:\+|%2[Bb])?1?\d{10,15}(?!\d)/g;
const UUID_PATTERN =
  /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const UUID_OR_PHONE = new RegExp(
  `(${UUID_PATTERN.source})|${PHONE_PATTERN.source}`,
  "g",
);
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_REDACTED = "[phone redacted]";
const EMAIL_REDACTED = "[email redacted]";
export const NAME_REDACTED = "[name redacted]";

export function redactPhones(text: string): string {
  return text.replace(UUID_OR_PHONE, (_match, uuid?: string) =>
    uuid ?? PHONE_REDACTED,
  );
}

export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, EMAIL_REDACTED);
}

/** Keys that carry a person's name: `name`, `*_name`, `*-name`, `*Name`. */
export function isNameKey(key: string): boolean {
  return /(?:^|[_-])name$|[a-z0-9]Name$/.test(key);
}

/**
 * Keys whose string value is a URL or path: PostHog's `$current_url` /
 * `$referrer` / `$pathname` / `$session_entry_url`, a navigation's `from` /
 * `to`, and the `Referer` header (single-r spelling included).
 */
export const URL_KEY_PATTERN = /url|referr?er|pathname|^(?:from|to)$/i;

/**
 * Drop the query string and fragment: `/inbox?q=Jane+Doe` → `/inbox`.
 * Query strings carry user-typed search terms (contact names, message-body
 * words — the inbox filter and the search palette both round-trip `?q=`
 * through URLs), which no digit-shaped redaction pattern can catch, so the
 * only safe move is to cut the URL at `?`/`#` entirely (D8/§10).
 */
/**
 * #296 — the campaign allow-list, DUPLICATED from `@loonext/shared` on purpose.
 *
 * This file is reached from `instrumentation-client.ts`, which Next bundles
 * WITHOUT a TypeScript loader for workspace sources: importing the shared
 * package here fails the production build on the first `type` keyword in its
 * barrel, and only in the build — vitest and tsc both resolve it happily, so
 * nothing local catches it.
 *
 * `scrub.test.ts` imports both and asserts they are identical, so the copy
 * cannot drift even though the import cannot exist.
 */
const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

/** The shared sanitiser's rule, same duplication and same guard. */
function sanitizeAttributionValue(raw: string | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 64) return null;
  return /^[A-Za-z0-9._~%+-]+$/.test(trimmed) ? trimmed : null;
}

export function stripQueryAndHash(url: string): string {
  const cut = url.search(/[?#]/);
  if (cut === -1) return url;
  const base = url.slice(0, cut);

  // #296: ONE exception, enumerated rather than inferred. Campaign parameters
  // describe an ad, never a person, and without them there is no way to tell
  // whether /compare or /for/plumbers produces a signup — six landing pages of
  // investment with no feedback loop.
  //
  // Everything else still goes, including the ?q= this function was written
  // for. The allow-list lives in @loonext/shared so the value that survives
  // here is the same one the capture stores, and widening it is one edit in a
  // file whose tests are about privacy.
  const kept = new URLSearchParams();
  try {
    const query = new URLSearchParams(url.slice(cut + 1).split("#")[0] ?? "");
    for (const key of ATTRIBUTION_PARAMS) {
      const value = sanitizeAttributionValue(query.get(key));
      if (value !== null) kept.set(key, value);
    }
  } catch {
    return base;
  }
  const suffix = kept.toString();
  return suffix === "" ? base : `${base}?${suffix}`;
}

/**
 * #558 — path segments that ARE a secret, so the path cannot be sent as-is.
 *
 * D75's public links carry a 256-bit token in the URL PATH, not the query, so
 * `stripQueryAndHash` above never touched them: opening a shared job-photos link
 * sent the token itself to PostHog as `$current_url` and `$pathname`, on every
 * view, retained by a third party. D75's second rule is that the plaintext is
 * returned once and never stored.
 *
 * An enumerated list, deliberately, not an entropy or length test. A classifier
 * here would be a threshold nobody could defend, and it would be wrong in the
 * direction that matters — a token it judged ordinary would be sent in full. The
 * vocabulary is small, knowable, and checked against the filesystem by
 * `scrub.test.ts`, which fails when a new `[token]` route has no rule here.
 *
 * Duplicated in the Worker's twin (apps/api/src/observability/scrub.ts) for the
 * same reason ATTRIBUTION_PARAMS is, and asserted identical by the same test.
 */
export const TOKEN_PATH_PREFIXES = ["photos", "invite", "pay", "q"] as const;
export const TOKEN_REDACTED = "[token]";

const TOKEN_SEGMENT_PATTERN = new RegExp(
  `/(${TOKEN_PATH_PREFIXES.join("|")})/[^/?#]+`,
  "g",
);

/** `/photos/<256 bits of secret>` → `/photos/[token]`. */
export function redactTokenPaths(url: string): string {
  return url.replace(TOKEN_SEGMENT_PATTERN, `/$1/${TOKEN_REDACTED}`);
}

/**
 * Full URL treatment: cut at `?`/`#`, redact secret path segments, then redact
 * phone-shaped ones.
 *
 * Tokens before phones on purpose. A base64url token can open with a ten-digit
 * run, and the phone pattern would then eat only that much of it and leave the
 * rest of the secret in place — a partial redaction that reads like a complete
 * one.
 */
export function scrubUrl(url: string): string {
  return redactPhones(redactTokenPaths(stripQueryAndHash(url)));
}

/**
 * Free text: an error message, a stack. Tokens first, for the reason
 * `scrubUrl` gives.
 */
export function scrubText(text: string): string {
  return redactPhones(redactEmails(redactTokenPaths(text)));
}

/**
 * Deep-scrub arbitrary JSON-ish data: strip name-keyed values, cut URL-keyed
 * values at the query string, redact phones and emails everywhere else.
 */
export function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value !== null && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isNameKey(key)) {
        scrubbed[key] = NAME_REDACTED;
      } else if (URL_KEY_PATTERN.test(key) && typeof entry === "string") {
        scrubbed[key] = scrubUrl(entry);
      } else {
        scrubbed[key] = scrubUnknown(entry);
      }
    }
    return scrubbed;
  }
  return value;
}
