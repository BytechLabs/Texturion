import type {
  Breadcrumb,
  CloudflareOptions,
  ErrorEvent,
} from "@sentry/cloudflare";

import { getEnv, type Bindings } from "../env";

/**
 * E.164-shaped digit runs (SPEC §10): optional '+' (or its URL-encoded form
 * %2B, so numbers inside URLs are caught too), optional country code 1, then
 * 10–15 digits, bounded so we do not fire inside longer identifiers (UUID
 * segments, Stripe/Telnyx ids) — no digit or letter immediately before, no
 * digit immediately after.
 */
const PHONE_PATTERN = /(?<![0-9A-Za-z])(?:\+|%2[Bb])?1?\d{10,15}(?!\d)/g;
const PHONE_REDACTED = "[phone redacted]";
const NAME_REDACTED = "[name redacted]";

export function redactPhones(text: string): string {
  return text.replace(PHONE_PATTERN, PHONE_REDACTED);
}

/** Keys that carry a person's name: `name`, `*_name`, `*-name`, `*Name`. */
function isNameKey(key: string): boolean {
  return /(?:^|[_-])name$|[a-z0-9]Name$/.test(key);
}

/** Deep-scrub arbitrary JSON-ish data: redact phones, strip name-keyed values. */
function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value !== null && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      scrubbed[key] = isNameKey(key) ? NAME_REDACTED : scrubUnknown(entry);
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
 * `beforeSend` scrubber (SPEC §10 PII policy): message bodies, contact names,
 * and phone numbers never reach Sentry.
 *
 * - E.164 patterns are redacted anywhere in the event message, log entry,
 *   exception values, breadcrumbs, request URL/headers, extra, tags, and
 *   contexts.
 * - Request bodies (`request.data`), cookies, and query strings are dropped
 *   outright.
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
    delete event.request.data; // request bodies never leave the Worker (§10)
    delete event.request.cookies;
    delete event.request.query_string; // may embed destination numbers / search terms
    if (event.request.url) {
      // Deleting `query_string` above doesn't touch the full URL, which embeds
      // the SAME params (search terms, addresses, destination numbers). Keep
      // only origin + path, then phone-redact what remains.
      const url = event.request.url;
      const cut = url.search(/[?#]/);
      event.request.url = redactPhones(cut === -1 ? url : url.slice(0, cut));
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

/**
 * Options factory for `Sentry.withSentry` (SPEC §3, §10). Runs per invocation
 * with the raw bindings, so a misconfigured Worker fails loudly here too.
 */
export function sentryOptions(bindings: Bindings): CloudflareOptions {
  const env = getEnv(bindings);
  return {
    dsn: env.SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
