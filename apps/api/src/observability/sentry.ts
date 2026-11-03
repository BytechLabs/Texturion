/**
 * Sentry's hooks over the shared scrubbers in ./scrub.ts (SPEC §10, D8):
 * message bodies, contact names, addresses, and phone numbers never reach
 * Sentry.
 */
import type {
  Breadcrumb,
  CloudflareOptions,
  ErrorEvent,
} from "@sentry/cloudflare";

import { getEnv, type Bindings } from "../env";
import { sentryEnvironment } from "../environments/policy";
import { mirrorToPostHog } from "./posthog-errors";
import { redactPhones, scrubHeaders, scrubUnknown, scrubUrl } from "./scrub";

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
    // Keeps a local or rig Worker's noise out of the production issue stream.
    // Named by DEPLOY_ENV rather than inferred from GIT_SHA, which any deploy
    // carrying a SHA would pass for (D142).
    environment: sentryEnvironment(env),
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
    // #652: the scrubbed event also goes to PostHog. Async on purpose: the SDK
    // waits for the hook and flushes through the invocation's waitUntil, so the
    // PostHog request is not cut off when the response returns.
    beforeSend: async (event) => {
      const scrubbed = scrubEvent(event);
      await mirrorToPostHog(env, scrubbed);
      return scrubbed;
    },
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
