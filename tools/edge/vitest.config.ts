import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The edge's suites run on workerd, beside real Durable Objects with SQLite
 * storage and hibernating WebSockets.
 *
 * Bindings are declared here rather than read from wrangler.jsonc: the deployed
 * config binds `loonext-telnyx-guard`, which does not exist in a test. Suites
 * pass their own stand-in for GUARD in the env they hand the Worker, and the
 * Durable Objects never call the guard, so nothing here needs it.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          UPLINK: { className: "RigUplink", useSQLite: true },
          MAILBOX: { className: "RobotMailbox", useSQLite: true },
        },
      },
    }),
  ],
  test: {
    name: "edge",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Every case starts by clearing two Durable Objects on disk, which is
    // slow on a loaded runner; the defaults made a slow disk read as a hang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
