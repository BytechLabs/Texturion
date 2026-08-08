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

/**
 * #558 — path segments that ARE a secret. Twin of TOKEN_PATH_PREFIXES in
 * apps/web/src/lib/observability/scrub.ts, duplicated rather than shared for the
 * reason recorded there, and asserted identical by that file's test.
 *
 * D75's public links carry the token in the PATH, so cutting at `?` leaves the
 * secret intact. This Worker serves `GET /photos/:token` itself, so an error on
 * that route would have put the live token in Sentry.
 *
 * Enumerated, not sniffed: a heuristic that misjudged a token would send it in
 * full, which is the wrong direction to be wrong in.
 */
export const TOKEN_PATH_PREFIXES = ["photos", "invite"] as const;
const TOKEN_REDACTED = "[token]";
const TOKEN_SEGMENT_PATTERN = new RegExp(
  `/(${TOKEN_PATH_PREFIXES.join("|")})/[^/?#]+`,
  "g",
);

/** `/photos/<256 bits of secret>` → `/photos/[token]`. */
export function redactTokenPaths(text: string): string {
  return text.replace(TOKEN_SEGMENT_PATTERN, `/$1/${TOKEN_REDACTED}`);
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
      // only origin + path, then redact secret path segments (#558: this Worker
      // serves GET /photos/:token, so the path itself can be the secret), then
      // phone-redact what remains.
      const url = event.request.url;
      const cut = url.search(/[?#]/);
      event.request.url = redactPhones(
        redactTokenPaths(cut === -1 ? url : url.slice(0, cut)),
      );
    }
    if (event.request.headers) {
      event.request.headers = scrubHeaders(
        event.request.headers as Record<string, string>,
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
    // A laptop reports nothing. Local failures are already on the terminal in
    // front of whoever caused them, and a developer running against a database
    // that is mid-migration raises errors indistinguishable from a production
    // incident on a customer-facing route. The marker is set in `.dev.vars`,
    // which only `wrangler dev` reads, so a deployed Worker cannot silence
    // itself: no marker means report. The DSN is still REQUIRED to boot, so a
    // Worker missing the secret fails loudly instead of going quietly dark.
    dsn: env.LOCAL_DEV === "1" ? undefined : env.SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // RELEASE TRACEABILITY: without this every production error was untagged —
    // you could see that something broke but not which deploy introduced it.
    // The Deploy workflow stamps the deployed commit (`--var GIT_SHA:<sha>`),
    // which is what makes Sentry's regression detection and suspect-commits
    // work. Undefined locally / on a manual deploy, which Sentry treats as an
    // untagged release rather than an error.
    release: env.GIT_SHA,
    // Keeps a local or preview Worker's noise out of the production issue
    // stream; without it every environment shared one bucket.
    environment: env.GIT_SHA ? "production" : "development",
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
