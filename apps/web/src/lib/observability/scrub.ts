/**
 * PII scrubbing for browser telemetry (SPEC §10, D8): message bodies, contact
 * names, and phone numbers never reach Sentry or PostHog.
 *
 * Browser twin of the API Worker's scrubber — keep the redaction logic in
 * sync with apps/api/src/observability/sentry.ts (same patterns, same
 * markers; only the Sentry SDK the types come from differs).
 *
 * THIS HEADER HAS NOW BEEN WRONG TWICE, THE SAME WAY, AND THAT IS THE POINT.
 *
 * The first note recorded that this file strips query strings from URL-carrying
 * fields and the Worker did not — a real gap, written down in both files, for a
 * year. Every outbound fetch the Worker made breadcrumbed its full URL: a
 * customer's street address to the geocoder, a typed search term, a presigned
 * URL to a recorded voicemail. It survived because it was PROSE. The
 * token-prefix list these two share had a test comparing both files and stayed
 * in step; the URL treatment had a comment and did not.
 *
 * Its replacement then said "No drift as of 2026-08-09" — which was the very day
 * #585 taught the Worker to drop console breadcrumbs and left this file behind.
 * A sentence asserting parity was the only thing standing where a test should
 * have been, for the second time, in the same file, about the same two clients.
 *
 * So `scrub.test.ts` now compares the BEHAVIOUR of both breadcrumb rules as well
 * as the source of both URL patterns, and reads the Worker's rule off disk with
 * a coverage assertion in front of it. Do not replace these tests with a claim
 * about them.
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
 * Duplicated in the Worker's twin (apps/api/src/observability/sentry.ts) for the
 * same reason ATTRIBUTION_PARAMS is, and asserted identical by the same test.
 */
export const TOKEN_PATH_PREFIXES = ["photos", "invite", "pay"] as const;
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

/**
 * `beforeBreadcrumb`.
 *
 * # Console crumbs are DROPPED, exactly as the Worker drops them (#585)
 *
 * `breadcrumbsIntegration` is a default in `@sentry/browser` with `console:
 * true`, and it builds the identical shape the Worker refuses: a formatted
 * `message` plus a `data.arguments` array of the raw values. Everything else in
 * this file is keyed on a field NAME — `url`, `*_name` — and free text has no
 * field name, so a URL interpolated into a log line walks straight past all of
 * it. `data.arguments` is an array, so `scrubUnknown` maps its strings through
 * `redactPhones` and no key ever matches `URL_KEY_PATTERN`.
 *
 * That was not hypothetical. `components/tasks/views/map-island.tsx` logs
 * `#428 basemap tiles are not loading (…). Sample: ${sample}` where `sample` is
 * a tile URL, and that line reached Sentry whole.
 *
 * The full reasoning for dropping rather than pattern-matching is written once,
 * at `apps/api/src/observability/sentry.ts`: a pattern list is a vocabulary and
 * the next thing worth redacting is always the one not in it, while SPEC §10
 * states as a COMMITMENT that names, addresses and message bodies never reach
 * Sentry. A commitment cannot rest on a definitionally incomplete matcher.
 *
 * # Where the browser's trade differs from the Worker's, and it is worse
 *
 * The Worker can afford this cheaply: `consoleIntegration` instruments console
 * rather than replacing it, so every `console.error` still lands in Cloudflare
 * Workers Logs in full. **A browser has no such log store.** What is lost here
 * is lost, not relocated.
 *
 * It is still the right trade, because the thing being protected is a promise
 * about a customer's data and the thing being spent is a developer's
 * convenience — but it is a real cost and is recorded rather than glossed. The
 * remedy when a console line genuinely matters for debugging is to capture it
 * deliberately, with the fields named, so the scrubbers above can see them.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Returning null drops the crumb — `addBreadcrumb` bails on a null
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
    // FILTER, not map: `scrubBreadcrumb` now returns null for a console crumb,
    // and a mapped null would leave a hole in the array rather than removing
    // the entry. Crumbs already on the scope when an event is built pass
    // through here, so this is the second place the console rule has to hold.
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
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
