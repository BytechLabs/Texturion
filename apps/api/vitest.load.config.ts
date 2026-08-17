import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * #251 load project — the SAME hermetic stack as `vitest.e2e.config.ts`, driven
 * concurrently instead of sequentially.
 *
 * ## Why this is a separate project rather than more e2e files
 *
 * Because it is opt-in. A burst scenario takes tens of seconds and answers a
 * question that does not change commit to commit, so putting it in the gate
 * would buy a slower CI and no extra signal. `pnpm --filter @loonext/api
 * test:load`, and `docs/CAPACITY.md` says so.
 *
 * ## What this CAN answer, and what it cannot
 *
 * It runs the REAL Worker handlers against REAL local Postgres with only the
 * vendor HTTP boundary faked. So it answers, honestly and reproducibly:
 *
 * - does a carrier retry storm delivered CONCURRENTLY create duplicate rows;
 * - does a burst of distinct events land completely, or silently drop some;
 * - when Postgres refuses to keep up, does a request come back with a truthful
 *   error or does it hang.
 *
 * That last one is #251's third acceptance criterion, and it is a property of
 * our code rather than of the deployment — which is precisely why it is worth
 * measuring here instead of waiting for an environment that does not exist.
 *
 * It CANNOT answer anything about workerd: this is node, so there are no
 * isolate limits, no CPU-time limits, and — see the alias below — no Durable
 * Objects. Absolute latencies here are node-and-laptop numbers and mean nothing
 * about production. The SHAPE of the degradation is the transferable finding;
 * the milliseconds are not. `docs/CAPACITY.md` repeats that where the numbers
 * are written down, because a number that reads as measured production capacity
 * and was measured on a laptop is the number somebody quotes to a prospect.
 */

/** Same reason as the e2e project: `cloudflare:workers` is unresolvable in node. */
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
    name: "load",
    environment: "node",
    include: ["e2e/**/*.load.ts"],
    // A burst of a few hundred round-trips against real Postgres, plus seeding.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // The fakes bind ephemeral ports and the DB is shared under a run prefix.
    fileParallelism: false,
  },
});
