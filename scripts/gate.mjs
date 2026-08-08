#!/usr/bin/env node
/**
 * Run the whole pre-push gate, in CI's order, as ONE command.
 *
 * WHY THIS EXISTS. The sequence — guards, typecheck, lint, test — has been
 * written down in the repo's own notes for weeks, and main still went red
 * twice in a row on 2026-08-03 from running three of the four. A docs file
 * with no status header, then a test file that vitest happily ran and `tsc`
 * rejected.
 *
 * Neither was a hard failure to find. Both were a step skipped because the
 * change "obviously" did not need it, and a four-step ritual has four chances
 * to be partially performed. One command has none.
 *
 * ORDER MATTERS, and it is CI's:
 *
 *   1. guards    — seven check-*.mjs steps that run BEFORE anything else in
 *                  Gate, and fail on things no test can see (client parity
 *                  rosters, action pins, open lists).
 *   2. typecheck — vitest TRANSPILES rather than type-checks, so a green test
 *                  run says nothing about types. Test files are exactly where
 *                  this hides: an aliased module is a mock at runtime and its
 *                  real signature to tsc.
 *   3. lint      — catches what tsc allows and CI refuses.
 *   4. test      — every workspace, not the one you think you touched. A
 *                  `docs/` edit is checked by packages/shared.
 *
 * NOT COVERED, deliberately, because each needs local infrastructure and
 * belongs to the change that touches it (see the repo notes):
 *   - `node scripts/db-test-all.mjs` after ANY migration (needs Docker).
 *   - `vitest --config vitest.e2e.config.ts` in apps/api for Worker wiring.
 *   - `next build` in apps/web when the change is reachable from
 *     instrumentation-client.ts.
 * The summary prints these as reminders rather than running them, because a
 * gate that fails on a stopped Docker daemon is a gate people stop running.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * How to invoke pnpm from a spawned shell.
 *
 * Not simply "pnpm": on Windows the child shell is cmd.exe, which does not
 * inherit the bash PATH this is usually launched from, and every step dies
 * with "'pnpm' is not recognized" — the same trap the repo notes record for
 * the root npm scripts. `npm_execpath` is set when this runs AS a pnpm script
 * (`pnpm gate`, the normal path); the fallbacks cover a bare
 * `node scripts/gate.mjs`.
 */
function pnpmCommand() {
  const viaPnpm = process.env.npm_execpath;
  if (viaPnpm && existsSync(viaPnpm)) return [process.execPath, [viaPnpm]];

  const appData = process.env.APPDATA;
  if (process.platform === "win32" && appData) {
    const shim = join(appData, "npm", "pnpm.cmd");
    if (existsSync(shim)) return [shim, []];
  }
  return ["pnpm", []];
}

const [PNPM, PNPM_PREFIX] = pnpmCommand();

const STEPS = [
  ["guards", ["check:guards"]],
  ["typecheck", ["-r", "typecheck"]],
  ["lint", ["-r", "lint"]],
  // ONE WORKSPACE AT A TIME. `pnpm -r test` runs them concurrently, and this
  // repo has a known IO-stall flake in the tree-walking guards that only
  // appears under load: the first run of this gate failed a single api test
  // with import time at 828s against 518s alone, and it passed immediately on
  // re-run. A gate that fails at random is a gate people stop running, which
  // costs far more than the ~20s serialising it back.
  ["test", ["-r", "--workspace-concurrency=1", "test"]],
];

const only = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]
  : null;
let steps = STEPS;
if (only) {
  const index = STEPS.findIndex(([name]) => name === only);
  if (index < 0) {
    console.error(`--from ${only} is not one of: ${STEPS.map((s) => s[0]).join(", ")}`);
    process.exit(2);
  }
  steps = STEPS.slice(index);
}

const started = process.hrtime.bigint();
for (const [name, args] of steps) {
  process.stdout.write(`\n▸ ${name}\n`);
  // QUOTED, because `shell: true` hands this to cmd.exe as a string. Node is
  // routinely installed under "C:\Program Files\nodejs", and an unquoted path
  // with a space in it made every step die with "'C:\Program' is not recognized"
  // — so this script, which exists to be the one command run before a push, could
  // not run at all on a default Windows install.
  const quote = (value) => (value.includes(" ") ? `"${value}"` : value);
  const result = spawnSync(
    quote(PNPM),
    [...PNPM_PREFIX.map(quote), ...args],
    {
      stdio: "inherit",
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.error(
      `\n  FAILED  ${name}\n\n` +
        `Fix it and re-run from here rather than from the top:\n` +
        `  pnpm gate --from ${name}\n`,
    );
    process.exit(1);
  }
}

const seconds = Number(process.hrtime.bigint() - started) / 1e9;
console.log(
  `\n${steps.length}/${steps.length} gate step(s) passed in ${seconds.toFixed(0)}s.\n\n` +
    `Still yours to run when they apply:\n` +
    `  - migrations touched?  node scripts/db-test-all.mjs  (needs Docker)\n` +
    `  - Worker entry/DO wiring touched?  pnpm --dir apps/api test:e2e\n` +
    `  - anything reachable from instrumentation-client.ts?  next build\n`,
);
