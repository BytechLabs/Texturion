/**
 * PII scrubbing for Worker telemetry (SPEC §10, D8): message bodies, contact
 * names, addresses, and phone numbers never reach Sentry.
 *
 * Worker twin of apps/web/src/lib/observability/scrub.ts — same patterns, same
 * markers, same URL treatment; only the Sentry SDK the types come from differs.
 *
 * PARITY NOTE, rewritten because the previous one hid the bug it described
 * (#581). It lived in the twin, said this file "only phone-redacts its URL
 * fields", and pointed at `request.url` — which had already been fixed, so the
 * sentence read as a stale nag about finished work while the field that had
 * never been covered at all, `breadcrumb.data.url`, went unnamed. Name the field
 * or do not write the note.
 *
 * The one intended difference left: the browser keeps an enumerated allow-list
 * of campaign parameters (`utm_*`, `gclid`) on the URLs it cuts, because signup
 * attribution has no other feedback loop. Nothing in this Worker attributes a
 * signup, so its cut is unconditional — absent on purpose, not unported.
 */
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
 * Keys whose string value is a URL or path. Twin of URL_KEY_PATTERN in
 * apps/web/src/lib/observability/scrub.ts, copied whole rather than narrowed to
 * the keys a Worker actually sees: a subset is what a twin drifts into, and
 * every case here is strictly MORE redaction than the default branch, so
 * carrying the browser's `pathname`/`referer` arms costs nothing.
 *
 * The arm that matters here is `url`. `fetchIntegration` is a DEFAULT integration
 * of @sentry/cloudflare and records `{ method, url, status_code }` for EVERY
 * outbound fetch, attached to any event captured in the same isolate — so until
 * #581 each of these shipped its query string to a third party:
 *   - Nominatim `/search?q=` — a customer's street address, one per geocode, and
 *     a whole batch of them when the geocode cron's AggregateError is captured;
 *   - PostgREST `PATCH /contacts?address=eq.` — the same address, as a filter;
 *   - PostgREST `GET /contacts?or=(name.ilike.*…*)` — whatever the crew typed;
 *   - PostgREST `GET /email_suppressions?email=in.(…)` — on every email send;
 *   - Telnyx's saved-recording URL — see `scrubUrl` for why the cut suffices.
 */
export const URL_KEY_PATTERN = /url|referr?er|pathname|^(?:from|to)$/i;

/**
 * Cut the query string and fragment: `/contacts?address=eq.140+Maple+Ave` →
 * `/contacts`.
 *
 * Cut, not redacted. Addresses, typed search terms and email addresses are not
 * digit-shaped, so no pattern can find them and leave the rest intact; for a
 * value nobody has seen yet, dropping it is the only treatment that holds.
 * Origin + path survives because that is the part a crash report needs — WHICH
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
 * rest of the secret in place — a partial redaction that reads like a complete
 * one.
 *
 * Telnyx's `recording_urls.mp3` is itself a bearer credential (anyone holding it
 * can download the caller's recorded voice for ten minutes), and the cut is
 * enough for it: Telnyx hands back an AWS SigV4 presigned URL, which carries
 * `X-Amz-Signature` and `X-Amz-Expires=600` in the QUERY STRING — Telnyx,
 * "Storing call recordings", read 2026-08-09. What survives the cut is a bucket
 * path that answers 403. Had the signature sat in the path instead, the shape
 * D75's own links use, cutting would have left the credential whole and the
 * value would have had to go in its entirety.
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
 * values at the query string, redact phones everywhere else.
 */
function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value !== null && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isNameKey(key)) {
        scrubbed[key] = NAME_REDACTED;
      } else if (URL_KEY_PATTERN.test(key) && typeof entry === "string") {
        // Keyed on the field NAME, which means a URL parked under a name that
        // does not say "url" (`recording_urls: { mp3 }`) falls through to the
        // phone pass. Kept key-driven anyway: sniffing every string for a `?`
        // would truncate real message text at its first question mark. Nothing
        // reaches Sentry by that route today — no webhook payload is attached to
        // an event or handed to console — and the crumb `fetchIntegration`
        // writes, the one path that carries all five sinks, uses `url`.
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
 * `beforeBreadcrumb`. Almost every crumb in this Worker is `fetchIntegration`'s,
 * so this is the hook that cuts an outbound URL — before the crumb is added to
 * the scope, rather than only on the way out with an event.
 *
 * # Console crumbs are DROPPED, and that is a decision (#585)
 *
 * `consoleIntegration` is on by default and turns every `console.error` into a
 * crumb carrying the formatted `message` and a `data.arguments` array of the raw
 * values. Everything else this file does is keyed on a field NAME — `url`,
 * `*_name` — and free text has no field name, so a URL interpolated into a log
 * line, or sitting inside that arguments array, walks straight past all of it.
 *
 * The alternative was a URL-shaped regex over the message and over every string
 * in the arguments. It was rejected, and not on taste:
 *
 *   * **It cannot be complete.** A pattern list is a vocabulary, and the next
 *     thing worth redacting is always the one not in it — a split URL, an encoded
 *     one, a bare street address, a typed search term. SPEC §10 states as a
 *     COMMITMENT that "message bodies, names, addresses, and phone numbers never
 *     reach Sentry". A commitment cannot rest on a matcher that is definitionally
 *     incomplete, and a passing test over the patterns somebody thought of reads
 *     as proof that it is.
 *   * **It would mangle honest log lines**, truncating any message that merely
 *     mentions a path at its first `?`.
 *
 * WHAT IS ACTUALLY LOST IS SMALL, because the crumb was a duplicate of a log we
 * already keep. `consoleIntegration` instruments console; it does not replace it,
 * so every `console.error` still reaches Cloudflare Workers Logs in full, and
 * `captureException` still carries the route tag and the ray id that joins an
 * event to those lines. The trail did not disappear — it stayed in our own log
 * store instead of being copied to a third party's.
 *
 * Structural rather than filtered, so it cannot drift: no console output reaches
 * Sentry at all, whatever a future `console.error` decides to interpolate.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // #585. Returning null drops the crumb — `addBreadcrumb` bails on a null
  // `beforeBreadcrumb` result before it ever reaches the scope.
  if (breadcrumb.category === "console") return null;
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
 * addresses, and phone numbers never reach Sentry.
 *
 * - E.164 patterns are redacted anywhere in the event message, log entry,
 *   exception values, breadcrumbs, request URL/headers, extra, tags, and
 *   contexts.
 * - Request bodies (`request.data`), cookies, and query strings are dropped
 *   outright, and EVERY URL-carrying field is cut at `?`/`#`: `request.url`
 *   here, plus any URL-keyed value in structured data, which is what covers the
 *   fetch breadcrumb's `data.url` (#581).
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
    // #585: `scrubBreadcrumb` can now drop a crumb entirely, so this filters
    // rather than maps. Belt and braces — `beforeBreadcrumb` already refused the
    // console ones on the way in — but an event can carry crumbs attached by
    // other means, and the two must not disagree about what is allowed out.
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  if (event.request) {
    delete event.request.data; // request bodies never leave the Worker (§10)
    delete event.request.cookies;
    delete event.request.query_string; // may embed destination numbers / search terms
    if (event.request.url) {
      // Deleting `query_string` above doesn't touch the full URL, which embeds
      // the SAME params (search terms, addresses, destination numbers). Same
      // treatment as every other URL-carrying field, through the same function,
      // so the two can no longer disagree about what a URL deserves.
      event.request.url = scrubUrl(event.request.url);
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
    // #581 asked whether outbound fetch breadcrumbs are worth keeping at all
    // once scrubbed. They are, so `integrations` stays unset and
    // `fetchIntegration({ breadcrumbs: false })` is deliberately NOT passed:
    // with `tracesSampleRate: 0` there are no spans, which makes those crumbs
    // the only record anywhere of which upstream call preceded a crash, and
    // every one of them is a call this Worker made to Nominatim, PostgREST,
    // Telnyx or Resend — where origin + path IS the diagnostic. What made them
    // dangerous was the query string, and that is now cut at the single hook
    // every crumb passes through. A second belt would buy nothing the cut does
    // not already buy, and would cost the trail.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
