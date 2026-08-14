/**
 * #577 step 2 — the `script-src` that needs a per-request nonce.
 *
 * The three directives that need no nonce shipped on their own in
 * `security-headers.ts`, which is where the static policy still lives. This is
 * the half that cannot be static: a nonce is a fresh random value per response,
 * so it can only be minted where the response is (middleware) and can only be
 * read by whatever renders the page (Next, from the request header).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SECOND HEADER RATHER THAN A LONGER FIRST ONE
 *
 * The static policy is delivered by `next.config.ts` `headers()`, which OpenNext
 * bakes into `routes-manifest.json` and applies to every matched response. That
 * mechanism is proven in this deployment. Middleware response headers are a
 * different path, and folding the whole policy into it would bet the working
 * clickjacking protection on a mechanism nobody here has watched in production.
 *
 * Two CSP headers are not a compromise: a browser enforces EVERY policy it is
 * given, so the effective policy is their intersection. If this header is ever
 * dropped the product is exactly as protected as it was yesterday; if it lands,
 * scripts are constrained as well. The one thing that would be wrong is joining
 * directives with a COMMA, which declares two policies inside one header — the
 * mistake `security-headers.test.ts` already has a test for.
 *
 * ---------------------------------------------------------------------------
 * REPORT-ONLY FIRST, AND THE COLLECTOR IS OURS
 *
 * #577 asks for report-only staging, and the last pass rightly refused to do it
 * with nowhere to send reports — Sentry's client path is blocked by ad blockers
 * for a large share of real users, so the violation data would be silently
 * partial, which is worse than knowing it is absent.
 *
 * The way out is that the collector does not have to be a third party. Reports
 * go to `/api/csp-report` on the SAME origin, which no blocker touches and no
 * CORS rule governs, and the route logs them where every other Worker log goes.
 *
 * ---------------------------------------------------------------------------
 * AND THE FINDING THAT DECIDES WHETHER THIS CAN EVER BE ENFORCED
 *
 * #577 says a `script-src` "needs per-request nonces, which is a middleware
 * change on both hosts". That understates it, and the understatement is why
 * this ships OFF by default rather than staged live.
 *
 * A nonce is minted per REQUEST. This product is prerendered: `next build`
 * emits 93 static HTML files, and they are the app's pages, not only the
 * marketing site — `/login`, `/settings/*`, `/tasks`. Measured on the build:
 * `login.html` carries 60 script tags, 17 of them inline, and ZERO with a
 * nonce, because there was no request when it was written. Under an enforcing
 * `'nonce-…' 'strict-dynamic'` policy every one of those is refused — and
 * `'strict-dynamic'` makes browsers ignore `'self'`, so the external chunks go
 * with them. The login page would be a blank screen.
 *
 * So enforcement is not one flag away; it needs those routes rendered per
 * request, which trades away the prerender the cache rule in #559 is anchored
 * to. That is a product decision with a real cost, and it is now a decision
 * somebody can make from a number rather than from a guess.
 *
 * Staging it live regardless would mean a violation report POSTed by every
 * visitor on every page for a fault we already know about — an open endpoint we
 * point at ourselves. Hence the switch: the machinery is complete and tested,
 * and turning it on is deliberate.
 */

/**
 * Whether to send the policy at all.
 *
 * `CSP_STAGING=report-only` turns it on for a staging window; anything else
 * (including absent, which is every environment today) sends nothing. Read per
 * call rather than captured at module load, because a Worker isolate outlives
 * many requests and a captured value would need a deploy to change.
 */
export function cspStagingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CSP_STAGING === "report-only";
}

/**
 * A fresh nonce for one response.
 *
 * Base64 of 16 random bytes: the CSP grammar wants base64, and 128 bits is far
 * past guessable. `crypto.getRandomValues` rather than `Math.random`, because a
 * predictable nonce is not a nonce — an attacker who can guess it can write a
 * `<script nonce=…>` that the policy welcomes.
 */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The path a violation report is POSTed to. Same-origin and relative, so it
 * works unchanged on the app host, the marketing host, the blog host and
 * localhost — none of which needs to know the others exist.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The `Reporting-Endpoints` group name `report-to` refers to. */
export const CSP_REPORT_GROUP = "csp";

/**
 * The nonce-bearing policy.
 *
 * `script-src 'self' 'nonce-…' 'strict-dynamic'`, and each piece earns its
 * place:
 *
 *   'nonce-…'         the only inline scripts that may run are the ones this
 *                     render marked — Next's own bootstrap, and the tag
 *                     manager's loader.
 *   'strict-dynamic'  a script that IS trusted may load more. This is what
 *                     makes the tag manager expressible at all: gtm.js is
 *                     injected by the nonced loader, and the tags gtm.js then
 *                     injects descend from it. Without it the only options are
 *                     a host allowlist (which the container can outgrow at any
 *                     time, from a console outside this repo) or breaking it.
 *   'self'            ignored by every browser that understands
 *                     'strict-dynamic', and the whole policy for one that does
 *                     not. Same-origin chunks keep working there.
 *
 * NO `'unsafe-inline'`, NO `'unsafe-eval'`, and no `https:` fallback. #577's own
 * argument is that a policy which permits what it exists to forbid reads as
 * protection to every audit that greps for the header; `security-headers.test`
 * pins that for the static policy and this file is held to it too.
 *
 * `worker-src 'self'` is here rather than assumed. Workers fall back to
 * `script-src` when it is absent, and under a nonce-only `script-src` that
 * would refuse to register the service worker — which is how the app receives
 * push. The one directive whose omission would break a shipped feature.
 */
export function nonceContentSecurityPolicy(nonce: string): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "worker-src 'self'",
    // Both spellings. `report-uri` is deprecated and is what Safari and older
    // Chrome actually send to; `report-to` is the replacement and needs the
    // `Reporting-Endpoints` header below to mean anything. Sending one would
    // silently collect from half the browsers.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join("; ");
}

/** The `Reporting-Endpoints` header value naming the group `report-to` uses. */
export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}

/**
 * Which header name carries it.
 *
 * REPORT-ONLY until the reports come back quiet, which is the staging #577
 * asks for and the reason this can ship without a flag: a report-only policy
 * blocks nothing, so the worst case of getting it wrong is noise in a log.
 * Enforcing is then a one-word change in this function, made on evidence.
 *
 * Next reads the nonce out of EITHER header (`app-render.js`:
 * `headers['content-security-policy'] || headers['content-security-policy-report-only']`),
 * so its own inline scripts are marked correctly while staging. Without that
 * the reports would be full of violations caused by the staging itself.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";
