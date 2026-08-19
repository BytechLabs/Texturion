import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * #251 — the Durable Object, on the runtime it actually runs on.
 *
 * ## The row this exists to close
 *
 * `docs/CAPACITY.md` §2 has one open unknown left: DO saturation. Its "why
 * local cannot answer it" column says, in the document's own words, that
 * "nothing in this repository has ever run a Durable Object under concurrency
 * on the real runtime" — `vitest.load.config.ts` aliases `cloudflare:workers`
 * to a double, so the node suites measure our FIFO and nothing else.
 *
 * Our FIFO is plain JavaScript and node tells the truth about it. What node
 * cannot tell the truth about is workerd: real Durable Object storage with real
 * I/O gates between it and the event loop, and a real single-threaded isolate.
 * Those are the properties #251 asks about.
 *
 * ## Opt-in, like the other load project
 *
 * `pnpm --filter @loonext/api test:workerd`. Not in the gate: it answers a
 * question that does not change commit to commit, and putting it there would
 * buy slower CI and no extra signal — the same reasoning the burst project
 * already records for itself.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./load/do-entry.ts",
      // Bindings are declared HERE rather than read from wrangler.jsonc on
      // purpose: the production config carries queues, rate limiters and
      // remote-only bindings that this measurement neither uses nor should have
      // to stand up. The one binding under test is the one declared.
      miniflare: {
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          CALL_SESSIONS: { className: "CallSessionDO", useSQLite: true },
        },
      },
      // Each test file gets its own storage, so one measurement cannot inherit
      // another's journal.
      isolatedStorage: true,
    }),
  ],
  test: {
    name: "workerd",
    include: ["load/**/*.workerd.ts"],
    // The measurements are printed, and a pool that swallows stdout makes this
    // project report "3 passed" and nothing worth reading.
    disableConsoleIntercept: true,
    testTimeout: 120_000,
  },
});
