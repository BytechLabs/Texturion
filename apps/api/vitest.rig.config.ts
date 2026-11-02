import { defineConfig } from "vitest/config";

/**
 * #251 -- load scenarios against the Loonext rig (docs/RIG.md).
 *
 * `pnpm --filter @loonext/api test:rig`, run ON the rig VM from a deployed
 * worktree's apps/api. Each file starts its own copy of the Worker under
 * wrangler (e2e/rig-stack.ts), so the Worker is on workerd, the Durable Object
 * is the real one, and the database is the rig's local Supabase stack.
 *
 * Opt-in and rig-only, for the reasons vitest.load.config.ts records, and one
 * more: assertRigVm refuses to run on any machine where a production name
 * resolves, so a laptop cannot run this by accident.
 *
 * Files run one at a time. They share one Postgres and one VM, and a burst
 * measured while another burst runs measures both.
 */
export default defineConfig({
  test: {
    name: "rig",
    environment: "node",
    include: ["e2e/**/*.rig.ts"],
    // Ramps run until a ceiling or a configured last level, then settle.
    testTimeout: 900_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    // The measurements are printed; a pool that swallows stdout hides them.
    disableConsoleIntercept: true,
  },
});
