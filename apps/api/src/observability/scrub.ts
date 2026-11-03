/**
 * PII scrubbing for Worker telemetry (SPEC §10, D8): message bodies, contact
 * names, addresses, email addresses and phone numbers never reach PostHog.
 *
 * Worker twin of apps/web/src/lib/observability/scrub.ts: same patterns, same
 * markers, same URL treatment, asserted identical by that file's test.
 *
 * The one intended difference: the browser keeps an enumerated allow-list of
 * campaign parameters (`utm_*`, `gclid`) on the URLs it cuts, because signup
 * attribution has no other feedback loop. Nothing in this Worker attributes a
 * signup, so its cut is unconditional.
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
const NAME_REDACTED = "[name redacted]";

export function redactPhones(text: string): string {
  return text.replace(UUID_OR_PHONE, (_match, uuid?: string) =>
    uuid ?? PHONE_REDACTED,
  );
}

export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, EMAIL_REDACTED);
}

/**
 * #558: path segments that ARE a secret. Twin of TOKEN_PATH_PREFIXES in
 * apps/web/src/lib/observability/scrub.ts.
 *
 * D75's public links carry the token in the PATH, so cutting at `?` leaves the
 * secret intact. This Worker serves `GET /photos/:token` itself, so an error on
 * that route would otherwise put the live token in the error tracker.
 *
 * Enumerated, not sniffed: a heuristic that misjudged a token would send it in
 * full, which is the wrong direction to be wrong in.
 */
export const TOKEN_PATH_PREFIXES = ["photos", "invite", "pay", "q"] as const;
const TOKEN_REDACTED = "[token]";
const TOKEN_SEGMENT_PATTERN = new RegExp(
  `/(${TOKEN_PATH_PREFIXES.join("|")})/[^/?#]+`,
  "g",
);

/** `/photos/<256 bits of secret>` → `/photos/[token]`. */
export function redactTokenPaths(text: string): string {
  return text.replace(TOKEN_SEGMENT_PATTERN, `/$1/${TOKEN_REDACTED}`);
}

/**
 * Free text from our own code: an error message, a stack, a notice's detail.
 * Tokens first, for the reason `scrubUrl` gives.
 */
export function scrubText(text: string): string {
  return redactPhones(redactEmails(redactTokenPaths(text)));
}

/**
 * Keys whose string value is a URL or path. Twin of URL_KEY_PATTERN in
 * apps/web/src/lib/observability/scrub.ts, copied whole rather than narrowed to
 * the keys a Worker actually sees: every case here is strictly MORE redaction
 * than the default branch.
 *
 * Until #581 the outbound fetch URLs this matched carried, in their query
 * strings, a customer's street address (Nominatim `/search?q=`, PostgREST
 * `?address=eq.`), whatever the crew typed (`?or=(name.ilike.*…*)`) and the
 * recipients of every email (`?email=in.(…)`).
 */
export const URL_KEY_PATTERN = /url|referr?er|pathname|^(?:from|to)$/i;

/**
 * Cut the query string and fragment: `/contacts?address=eq.140+Maple+Ave` →
 * `/contacts`.
 *
 * Cut, not redacted. Addresses, typed search terms and email addresses are not
 * digit-shaped, so no pattern can find them and leave the rest intact; for a
 * value nobody has seen yet, dropping it is the only treatment that holds.
 * Origin + path survives because that is the part a crash report needs: WHICH
 * upstream call failed.
 */
function stripQueryAndHash(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Full URL treatment: cut at `?`/`#`, redact secret path segments, then redact
 * phone-shaped ones.
 *
 * Tokens before phones on purpose. A base64url token can open with a ten-digit
 * run, and the phone pattern would then eat only that much of it and leave the
 * rest of the secret in place, a partial redaction that reads like a complete
 * one.
 *
 * Telnyx's `recording_urls.mp3` is itself a bearer credential, and the cut is
 * enough for it: Telnyx hands back an AWS SigV4 presigned URL, which carries
 * `X-Amz-Signature` in the QUERY STRING (Telnyx, "Storing call recordings",
 * read 2026-08-09). What survives the cut is a bucket path that answers 403.
 */
export function scrubUrl(url: string): string {
  return redactPhones(redactTokenPaths(stripQueryAndHash(url)));
}

/** Keys that carry a person's name: `name`, `*_name`, `*-name`, `*Name`. */
function isNameKey(key: string): boolean {
  return /(?:^|[_-])name$|[a-z0-9]Name$/.test(key);
}

/**
 * The only request headers worth keeping on a crash report.
 *
 * An ALLOWLIST, deliberately. `authorization` carries the caller's live access
 * token, good for up to an hour, and anyone who can read the error tracker
 * could replay it as that user. With a denylist the next credential header
 * anyone adds leaks until a human remembers it; with this it is redacted until
 * a human decides it is safe.
 */
const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-length",
  "content-type",
  "user-agent",
  // Cloudflare request identity: the whole point of a crash report is being
  // able to find the request again in the edge logs.
  "cf-ray",
  "cf-ipcountry",
  "x-request-id",
]);

const HEADER_REDACTED = "[redacted]";

/**
 * Keep the handful of headers that help debugging; redact the rest by name so
 * the issue still shows WHICH headers were present without their values.
 */
export function scrubHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    scrubbed[key] = SAFE_REQUEST_HEADERS.has(key.toLowerCase())
      ? redactPhones(value)
      : HEADER_REDACTED;
  }
  return scrubbed;
}

/**
 * Deep-scrub arbitrary JSON-ish data: strip name-keyed values, cut URL-keyed
 * values at the query string, redact phones and emails everywhere else.
 *
 * Keyed on the field NAME, so a URL parked under a name that does not say
 * "url" falls through to the text pass. Kept key-driven anyway: sniffing every
 * string for a `?` would truncate real message text at its first question mark.
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

/**
 * The shapes SPEC §10 forbids in an event's properties (#418).
 *
 * Shape-based rather than key-based. A key-name blocklist ("phone", "email")
 * catches the careless author and misses the one who writes
 * `{ contact: "+16135551234" }`. What matters is what the VALUE is.
 */
const FORBIDDEN_PROPERTY: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  // E.164 and the loose North American forms people actually type, anywhere in
  // the value.
  { what: "phone number", pattern: /\+?\d[\d\s().-]{8,}\d/ },
  { what: "email address", pattern: /[^\s@]+@[^\s@]+\.[^\s@]{2,}/ },
];

/**
 * Prose has words; an enumeration does not. Every property this codebase
 * sends is a single token (`"pro"`, `"submitted"`, `"US"`), so four or more
 * words is a sentence, and a sentence is a thing a person wrote. The length cap
 * is a second net, for a one-token value long enough to be an identifier.
 */
const MAX_PROPERTY_WORDS = 3;
const MAX_PROPERTY_LENGTH = 64;

/**
 * Drop any property that looks like a person and hand `report` a message
 * naming the key and the offence, never the value: reporting a leak by
 * repeating it would be worse than the leak.
 *
 * Drops rather than throws. Telemetry must never break the send or webhook
 * path that fired the event, but a silent drop would hide the bug, so the
 * caller reports it.
 */
export function scrubProperties(
  event: string,
  properties: Record<string, unknown>,
  report: (message: string) => void,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string") {
      // Numbers, booleans and null cannot carry a body, an address or a name.
      safe[key] = value;
      continue;
    }
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    const offence =
      words > MAX_PROPERTY_WORDS || value.length > MAX_PROPERTY_LENGTH
        ? "free text"
        : FORBIDDEN_PROPERTY.find((rule) => rule.pattern.test(value))?.what;
    if (offence === undefined) {
      safe[key] = value;
      continue;
    }
    report(
      `posthog capture '${event}': dropped property '${key}', which looks like ` +
        `a ${offence}; SPEC §10 keeps those out of third-party telemetry`,
    );
  }
  return safe;
}
