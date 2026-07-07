/**
 * PII scrubbing for browser telemetry (SPEC §10, D8): message bodies, contact
 * names, and phone numbers never reach Sentry or PostHog.
 *
 * Browser twin of the API Worker's scrubber — keep the redaction logic in
 * sync with apps/api/src/observability/sentry.ts (same patterns, same
 * markers; only the Sentry SDK the types come from differs). Known drift as
 * of 2026-07-07: this file also strips query strings/fragments from every
 * URL-carrying field (request.url, breadcrumb url/from/to, Referer) because
 * browser search-as-you-type round-trips typed names and message words
 * through `?q=`; the API twin still only phone-redacts its URL fields and
 * should adopt the same stripping for /v1/search?q= Worker-side errors.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/browser";

/**
 * E.164-shaped digit runs (SPEC §10): optional '+' (or its URL-encoded form
 * %2B, so numbers inside URLs are caught too), optional country code 1, then
 * 10–15 digits, bounded so we do not fire inside longer identifiers (UUID
 * segments, Stripe/Telnyx ids) — no digit or letter immediately before, no
 * digit immediately after.
 */
const PHONE_PATTERN = /(?<![0-9A-Za-z])(?:\+|%2[Bb])?1?\d{10,15}(?!\d)/g;
const PHONE_REDACTED = "[phone redacted]";
export const NAME_REDACTED = "[name redacted]";

export function redactPhones(text: string): string {
  return text.replace(PHONE_PATTERN, PHONE_REDACTED);
}

/** Keys that carry a person's name: `name`, `*_name`, `*-name`, `*Name`. */
export function isNameKey(key: string): boolean {
  return /(?:^|[_-])name$|[a-z0-9]Name$/.test(key);
}

/**
 * Keys whose string value is a URL or path: PostHog's `$current_url` /
 * `$referrer` / `$pathname` / `$session_entry_url`, Sentry fetch/XHR
 * breadcrumb `data.url`, navigation breadcrumb `data.from` / `data.to`, and
 * the `Referer` request header (single-r spelling included). Shared with
 * lib/analytics/posthog.ts so both telemetry clients cut URLs identically.
 */
export const URL_KEY_PATTERN = /url|referr?er|pathname|^(?:from|to)$/i;

/**
 * Drop the query string and fragment: `/inbox?q=Jane+Doe` → `/inbox`.
 * Query strings carry user-typed search terms (contact names, message-body
 * words — the inbox filter and the search palette both round-trip `?q=`
 * through URLs), which no digit-shaped redaction pattern can catch, so the
 * only safe move is to cut the URL at `?`/`#` entirely (D8/§10).
 */
export function stripQueryAndHash(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Full URL treatment: cut at `?`/`#`, then redact phone-shaped path segments. */
export function scrubUrl(url: string): string {
  return redactPhones(stripQueryAndHash(url));
}

/**
 * Deep-scrub arbitrary JSON-ish data: strip name-keyed values, cut URL-keyed
 * values at the query string, redact phones everywhere else.
 */
export function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
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

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = redactPhones(breadcrumb.message);
  }
  if (breadcrumb.data) {
    breadcrumb.data = scrubUnknown(breadcrumb.data) as typeof breadcrumb.data;
  }
  return breadcrumb;
}

/**
 * `beforeSend` scrubber (SPEC §10 PII policy) — identical posture to the API:
 *
 * - E.164 patterns are redacted anywhere in the event message, log entry,
 *   exception values, breadcrumbs, request URL/headers, extra, tags, and
 *   contexts.
 * - Request bodies (`request.data`), cookies, and query strings are dropped
 *   outright, and EVERY URL-carrying field is cut at `?`/`#` before it
 *   leaves the browser: `request.url` (location.href — the inbox filter
 *   round-trips `?q=<typed term>` through the page URL), fetch/XHR
 *   breadcrumb `data.url` (the search palette fires GET /v1/search?q= per
 *   keystroke), and navigation breadcrumb `data.from`/`data.to`. Typed
 *   names and message words are not digit-shaped, so redaction alone cannot
 *   catch them — stripping is the only safe treatment.
 * - Contact names are stripped: any `name`/`*_name`/`*Name` key in structured
 *   data is replaced, and `event.user` is reduced to its id.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) {
    event.message = redactPhones(event.message);
  }
  if (event.logentry?.message) {
    event.logentry.message = redactPhones(event.logentry.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = redactPhones(exception.value);
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  if (event.request) {
    delete event.request.data; // page payloads never leave the browser (§10)
    delete event.request.cookies;
    delete event.request.query_string; // embeds destination numbers / typed search terms
    if (event.request.url) {
      // location.href: cut the query/fragment (typed search terms live
      // there), then phone-redact what remains of the path.
      event.request.url = scrubUrl(event.request.url);
    }
    if (event.request.headers) {
      event.request.headers = scrubUnknown(
        event.request.headers,
      ) as typeof event.request.headers;
    }
  }
  if (event.user) {
    const id = event.user.id;
    if (typeof id === "string" || typeof id === "number") {
      event.user = { id };
    } else {
      delete event.user;
    }
  }
  if (event.extra) {
    event.extra = scrubUnknown(event.extra) as typeof event.extra;
  }
  if (event.tags) {
    event.tags = scrubUnknown(event.tags) as typeof event.tags;
  }
  if (event.contexts) {
    event.contexts = scrubUnknown(event.contexts) as typeof event.contexts;
  }
  return event;
}
