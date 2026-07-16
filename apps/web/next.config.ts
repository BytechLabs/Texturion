import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";
import rehypeSlug from "rehype-slug";

import { SECURITY_HEADERS } from "./src/lib/observability/security-headers";

const nextConfig: NextConfig = {
  // Optional isolated build output dir (LOONEXT_DIST_DIR) so a production build
  // can run without colliding with a concurrently-running `next dev` that shares
  // the default `.next`. No effect when the env var is unset.
  ...(process.env.LOONEXT_DIST_DIR
    ? { distDir: process.env.LOONEXT_DIST_DIR }
    : {}),
  // SPEC §3: next/image runs unoptimized on Cloudflare Workers (Cloudflare
  // Images is separately billed and the dashboard doesn't need it).
  images: {
    unoptimized: true,
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
        source: "/(.*)",
        headers: [...SECURITY_HEADERS],
      },
      // Edge-cache the marketing HTML so repeat requests skip the OpenNext
      // worker (and its Cloudflare cold-isolate TTFB, ~1.3-1.9s on a cold hit;
      // Ahrefs Site Audit "Slow page", 2026-07). Every (marketing) page is
      // fully static SSG — no cookies()/headers()/dynamic — and identical for
      // all visitors (country, consent, theme are client-side), so the HTML is
      // safe to share-cache. HOST-scoped to the apex: `source` matches PATH
      // only, and `/` (plus other shared paths) also resolves on
      // app.loonext.com, so a path rule would cache authed dashboard pages —
      // the host predicate is what keeps the app's responses uncached.
      // Pairs with a Cloudflare Cache Rule that marks http.host eq
      // "loonext.com" eligible for cache (HTML is not cached by default);
      // s-maxage drives the shared-cache TTL, max-age=0 keeps browsers
      // revalidating so a deploy-time purge is visible on the next reload.
      {
        source: "/(.*)",
        has: [{ type: "host", value: "loonext.com" }],
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
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
// src/mdx-components.tsx (Next App Router convention).
//
// KNOWN `next dev` LIMITATION (production is unaffected): under `next dev`,
// Next's SWC transforms the MDX-emitted JSX with the *development* jsx runtime
// (`jsxDEV`), and React 19.2's `jsxDEV` reads an owner-stack internal
// (`recentlyCreatedOwnerStacks`) that isn't initialized in the RSC server
// dispatcher Next 15.5 wires, so an individual /blog/<slug> post 500s in the
// dev server (the /blog index and the rest of the app render fine). `next build`
// uses the stable `jsx` runtime and prerenders every post correctly, so the
// deployed blog works. Preview posts via a production build or the deployed
// site until the upstream Next/React combo ships the fix — no code change here
// will be needed then.
const withMDX = createMDX({
  options: {
    rehypePlugins: [rehypeSlug],
  },
});

export default withMDX(nextConfig);

// Gives `next dev` access to the Cloudflare bindings declared in wrangler.jsonc.
// No-op outside the dev server.
initOpenNextCloudflareForDev();
