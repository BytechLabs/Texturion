import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The guard on the runtime it runs on: the real Worker entry, the real
 * Durable Object and its storage and alarms. The node suites prove the policy;
 * this proves the wiring they cannot see (the caller check before the Durable
 * Object, the storage adapter, the alarm the lease sets).
 *
 * Bindings are declared here rather than read from wrangler.jsonc: the AI
 * binding is remote-only, and nothing here may reach a vendor or production.
 * Every outbound request is answered locally with a 503.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-06-01",
        durableObjects: {
          GUARD: { className: "GuardState", useSQLite: true },
        },
        bindings: {
          TELNYX_CONCURRENT_LIMIT: "unknown",
          SIGNAL_LATCH_RESET: "workerd",
        },
        outboundService: () => new Response("offline in tests", { status: 503 }),
      },
    }),
  ],
  test: {
    name: "guard-workerd",
    include: ["test/**/*.workerd.ts"],
  },
});
