import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * D31 launch-pass E2E project — SEPARATE from vitest.config.ts.
 *
 * The unit projects stub global fetch and alias the telnyx contract modules to
 * doubles; this project does NEITHER. It runs the REAL Worker (`app.fetch`)
 * against the REAL local Supabase with only the vendor HTTP boundary faked
 * (in-process node:http servers reached via env.TELNYX_API_BASE /
 * STRIPE_API_BASE). It therefore loads no unit setup and matches only
 * `e2e/**\/*.e2e.ts`.
 *
 * Run: `pnpm vitest run --config vitest.e2e.config.ts` (or `pnpm test:e2e`).
 */

/**
 * Calls v3 (#170 §15.2): the real Worker entry re-exports CallSessionDO, which
 * extends DurableObject from `cloudflare:workers` — a Workers-runtime module
 * node cannot resolve. This project loads the real app, so it needs the same
 * no-op double the unit projects use. The DO itself is never exercised by the
 * golden paths (checkout → provision → register → send, not inbound calls);
 * the alias only has to make the module resolvable under node.
 */
const cloudflareWorkersDouble = {
  find: /^cloudflare:workers$/,
  replacement: fileURLToPath(
    new URL("./src/test/cloudflare-workers-double.ts", import.meta.url),
  ),
};

export default defineConfig({
  resolve: {
    alias: [cloudflareWorkersDouble],
  },
  test: {
    name: "e2e",
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    // A full golden-path sequence (checkout → provision → register → send)
    // does several signed round-trips against real Postgres.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Fakes bind ephemeral ports and seed a shared DB under a run prefix; keep
    // the suite serial so port/DB state is never contended across files.
    fileParallelism: false,
  },
});
