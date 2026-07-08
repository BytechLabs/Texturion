/**
 * RFC 9116 security.txt, served at /.well-known/security.txt.
 *
 * A route handler (not a static public/ file) because the REQUIRED Expires
 * field must stay in the future: it is computed at request time as now + 180
 * days (RFC 9116 recommends under a year). `force-dynamic` opts the handler
 * out of build-time prerendering so the timestamp is never frozen at deploy;
 * the 1-day CDN cache keeps the per-request cost at effectively zero while
 * leaving 179 days of validity headroom.
 *
 * The middleware matcher already skips dotted paths, so this route is served
 * on every host the web app answers on; Canonical pins the loonext.com copy
 * as the authoritative one.
 */

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
// RFC 9116 validity window: half a year, well under the recommended max.
// (Not exported: Next.js type-checks route.ts against an allowlist of export
// names, and extra named exports fail the build. The test re-derives it.)
const EXPIRES_DAYS = 180;

export function GET(): Response {
  const expires = new Date(Date.now() + EXPIRES_DAYS * DAY_MS).toISOString();
  const body = [
    "Contact: mailto:security@loonext.com",
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    "Canonical: https://loonext.com/.well-known/security.txt",
    "Policy: https://loonext.com/security",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
