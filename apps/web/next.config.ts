import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

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

export default nextConfig;

// Gives `next dev` access to the Cloudflare bindings declared in wrangler.jsonc.
// No-op outside the dev server.
initOpenNextCloudflareForDev();
