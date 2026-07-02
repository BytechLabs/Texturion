import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SPEC §3: next/image runs unoptimized on Cloudflare Workers (Cloudflare
  // Images is separately billed and the dashboard doesn't need it).
  images: {
    unoptimized: true,
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
    ];
  },
};

export default nextConfig;

// Gives `next dev` access to the Cloudflare bindings declared in wrangler.jsonc.
// No-op outside the dev server.
initOpenNextCloudflareForDev();
