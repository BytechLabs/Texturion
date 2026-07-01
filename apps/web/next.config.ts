import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SPEC §3: next/image runs unoptimized on Cloudflare Workers (Cloudflare
  // Images is separately billed and the dashboard doesn't need it).
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

// Gives `next dev` access to the Cloudflare bindings declared in wrangler.jsonc.
// No-op outside the dev server.
initOpenNextCloudflareForDev();
