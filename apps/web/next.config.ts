import { readFileSync } from "node:fs";

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";
import rehypeSlug from "rehype-slug";

import { SECURITY_HEADERS } from "./src/lib/observability/security-headers";

/**
 * The shipped version, read from this package at build time. release-please
 * bumps package.json on every release, so the string a user reads in Settings
 * is exactly the release that built the bundle — nothing to keep in sync by
 * hand. Read from disk rather than an npm_* env var so it is correct however
 * the build is invoked (next build, the OpenNext adapter, CI).
 */
const APP_VERSION: string = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

/**
 * #559 — public links whose HTML must never sit in a shared cache.
 *
 * D75 promises revocation works. These pages are reached with a token and can be
 * revoked at any moment, so an hour of edge TTL is an hour of a revoked link
 * still opening for whoever already has the address. The photo page's own
 * comment already claimed no-store; the header on the wire said otherwise.
 *
 * The same list drives the exclusion from the apex cache rule and the positive
 * no-store rule, so the two cannot disagree — which is the whole reason a
 * `/photos` that nobody had excluded came to be cached for an hour.
 *
 * Kept in step with the redaction list in src/lib/observability/scrub.ts by
 * next-config-headers.test.ts: a link type whose token must be scrubbed is a
 * link type that can be revoked.
 */
// #224: `pay` joins them, and it is the one where an hour of stale edge TTL
// would be worst — the page has to stop opening the MOMENT the bill is paid,
// or a homeowner meets a card form for money they already sent.
// #287 adds "q": a quote link opens a page with a price on it, and a shared
// machine must not keep it after the link stops opening.
const UNCACHEABLE_TOKEN_PREFIXES = ["photos", "invite", "pay", "q"] as const;
/**
 * The alternation is wrapped, and that is load-bearing: `(?!photos|invite/)`
 * binds the slash to the LAST alternative only, so it would exclude every path
 * beginning "photos" — `/photos-for-plumbers` included — while requiring the
 * slash for `invite`. `(?:…)` makes the group mean what it reads as.
 */
const UNCACHEABLE_PREFIX_GROUP = `(?:${UNCACHEABLE_TOKEN_PREFIXES.join("|")})`;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  // Optional isolated build output dir (LOONEXT_DIST_DIR) so a production build
  // can run without colliding with a concurrently-running `next dev` that shares
  // the default `.next`. No effect when the env var is unset.
  ...(process.env.LOONEXT_DIST_DIR
    ? { distDir: process.env.LOONEXT_DIST_DIR }
    : {}),
  // mdx MUST be listed here (the documented @next/mdx step). Beyond enabling
  // .mdx route files, Next builds its layer-scoped vendored-React alias rule
  // from this list (webpack-config.ts aliasCodeConditionTest): without "mdx",
  // an RSC-layer content.mdx module resolves `react/jsx-dev-runtime` to the
  // USERLAND client runtime while its `react` import resolves to the VENDORED
  // react-server flavor, and `next dev` 500s every post page with
  // "Cannot read properties of undefined (reading 'recentlyCreatedOwnerStacks')".
  // Production was never affected (stable jsx runtime), but dev needs the pair
  // matched. No .js/.jsx route files exist under src/app, so they stay unlisted.
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  // SPEC §3: next/image runs unoptimized on Cloudflare Workers (Cloudflare
  // Images is separately billed and the dashboard doesn't need it).
  images: {
    unoptimized: true,
  },
  /**
   * Repo markdown imports as a STRING, resolved at build time.
   *
   * The three legal pages generated from `docs/*.md` and `SECURITY.md` used to
   * `readFileSync` those documents while rendering. That is fine in `next build`
   * and fatal in the deployed Worker, which has no repo on disk and a
   * `process.cwd()` of `/` — every one of them answered 500 in production from
   * the day it shipped, because a page that renders on the server renders on the
   * SERVER, and this server is not a filesystem.
   *
   * `asset/source` hands the module its raw text, so the document is bundled
   * with the page and the request path never touches `fs`. Only `.md` — the
   * blog's `.mdx` still goes through the MDX loader below, which claims that
   * extension and not this one.
   */
  webpack(config) {
    config.module.rules.push({ test: /\.md$/, type: "asset/source" });
    return config;
  },
  // Hide the `next dev` indicator (the floating "N" badge). It's dev-only, but
  // the marketing screenshots are captured against the running dev server
  // (apps/web/scripts/capture-shots.mjs), so leaving it on baked the badge into
  // committed product shots. Off means every capture is clean chrome.
  devIndicators: false,
  // Barrel-import optimization (iteration-4 Lighthouse fix): the marketing +
  // app code imports named exports from the `lucide-react` and `radix-ui`
  // META-packages in 98 / 19 files. Without this, a barrel import can pull far
  // more of the package into the shared vendor chunk than the few symbols used;
  // rewriting them to per-module deep imports keeps the shared chunk (and thus
  // its parse/eval cost, the TBT driver) to only what's actually referenced.
  experimental: {
    optimizePackageImports: ["lucide-react", "radix-ui"],
    // Inline each route's CSS into the HTML instead of a render-blocking
    // <link rel="stylesheet"> (VISUALS-V2 §7, the mobile Lighthouse >=90 gate).
    // On simulated Slow-4G the global stylesheet was a render-blocking resource
    // gating first paint; inlining removes that round-trip so the hero H1 (the
    // LCP element) paints from the HTML alone — measured ~+2 mobile perf points
    // and ~150 ms FCP vs. the linked stylesheet. Pure delivery optimization: no
    // styling/token/app-surface change.
    inlineCss: true,
  },
  // Security response headers on every route (D8 defense in depth). The list
  // + the proof that headers() survives the OpenNext/Workers adapter live in
  // src/lib/observability/security-headers.ts.
  async headers() {
    return [
      {
        // #232: everything EXCEPT the widget preview, which the settings page
        // frames on purpose. The global list carries `frame-ancestors 'none'`
        // and `X-Frame-Options: DENY`, and both are right for every other
        // route — a browser enforces every CSP it is given, so a route handler
        // cannot loosen them by setting its own header. The exclusion is a
        // negative lookahead here rather than a second rule below, because a
        // second rule would ADD a header next to the deny rather than replace
        // it.
        //
        // Safe for this one path on its own terms: the preview is a static
        // document with no session, no authenticated data and nothing a
        // clickjacker could aim a cursor at. Its only form posts a literal
        // `preview` key that resolves to no workspace.
        source: "/((?!widget-preview$).*)",
        headers: [...SECURITY_HEADERS],
      },
      {
        // The preview's own posture: framed by US and nobody else.
        source: "/widget-preview",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'none'",
              "script-src 'self'",
              "style-src 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // Edge-cache the marketing HTML so repeat requests skip the OpenNext
      // worker (and its Cloudflare cold-isolate TTFB, ~1.3-1.9s on a cold hit;
      // Ahrefs Site Audit "Slow page", 2026-07). Every (marketing) page is
      // fully static SSG — no cookies()/headers()/dynamic — and identical for
      // all visitors (country, consent, theme are client-side), so the HTML is
      // safe to share-cache. HOST-scoped to the apex: `source` matches PATH
      // only, and `/` (plus other shared paths) also resolves on
      // app.loonext.com, so a path rule alone would cache authed pages too.
      //
      // #559: the host value is ANCHORED. Next anchors a `has` host predicate;
      // OpenNext compiles it to an UNANCHORED regex, where a bare
      // "loonext.com" also matches app.loonext.com — verified live, the app
      // host was returning this same s-maxage with no Vary: Cookie. `^…$` is
      // correct under both matchers, so this is the value to write regardless
      // of which one is running. It has never leaked anything: there is no
      // cookies() or next/headers anywhere under app/(app), so signed-in HTML
      // is an empty client-fetched shell. What it DID risk is a stale app shell
      // pointing at chunk hashes a deploy has already purged.
      //
      // Pairs with a Cloudflare Cache Rule that marks http.host eq
      // "loonext.com" eligible for cache (HTML is not cached by default);
      // s-maxage drives the shared-cache TTL, max-age=0 keeps browsers
      // revalidating so a deploy-time purge is visible on the next reload.
      {
        // #559: excluded by PATTERN, not by rule order. A shared photo link is
        // revocable, and an hour of shared-cache TTL is an hour of a revoked
        // link still opening. Relying on the more specific rule below to win
        // would be relying on precedence nobody here has verified.
        source: `/:path((?!${UNCACHEABLE_PREFIX_GROUP}/).*)`,
        has: [{ type: "host", value: "^loonext\\.com$" }],
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      // #559: and stated positively as well, so the page carries the header it
      // has always claimed to. Matches what the API sends for the same token
      // from apps/api/src/public-links/guard.ts. Not host-scoped: a revocable
      // link must be uncacheable wherever it is served.
      ...UNCACHEABLE_TOKEN_PREFIXES.map((prefix) => ({
        source: `/${prefix}/:token*`,
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      })),
    ];
  },
  async redirects() {
    return [
      // The API's invite email points at /invites/accept?invite_id=… (see
      // apps/api/src/routes/team.ts); the canonical accept page lives at
      // /invite/[token] (G3). Other query params (Supabase auth code) pass
      // through automatically.
      {
        source: "/invites/accept",
        has: [{ type: "query", key: "invite_id", value: "(?<inviteId>.*)" }],
        destination: "/invite/:inviteId",
        permanent: false,
      },
      // Defense in depth for notification links: the thread route is
      // /inbox/[conversationId]. Emails now link there directly, and the
      // service worker normalizes push URLs — this catches anything already
      // in flight (queued pushes, old emails) that still carries the legacy
      // /conversations/:id shape.
      {
        source: "/conversations/:id",
        destination: "/inbox/:id",
        permanent: false,
      },
    ];
  },
};

// #130: MDX blog. `content.mdx` files are imported into each post's thin
// page.tsx and compiled to React at BUILD time (webpack loader — `next build`
// is webpack here, no turbopack), so there's no runtime MDX and the OpenNext/
// Workers output is unchanged. rehype-slug gives every `##` heading a stable
// id so in-article anchors keep working. The element→component styling map is
// src/mdx-components.tsx (Next App Router convention). The dev-server 500 the
// blog used to hit was NOT an upstream limitation: it was the missing "mdx"
// pageExtensions entry above.
const withMDX = createMDX({
  options: {
    rehypePlugins: [rehypeSlug],
  },
});

export default withMDX(nextConfig);

// Gives `next dev` access to the Cloudflare bindings declared in wrangler.jsonc.
// No-op outside the dev server.
initOpenNextCloudflareForDev();
