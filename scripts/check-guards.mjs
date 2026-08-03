#!/usr/bin/env node
/**
 * Run every standalone guard the CI gate runs before typecheck.
 *
 * WHY THIS EXISTS. `pnpm -r test` is not the gate. The "Typecheck, lint, test"
 * job runs seven `node scripts/check-*.mjs` steps FIRST, and none of them is a
 * vitest file, so a fully green local `test` run says nothing about them. That
 * is not hypothetical: #233 pushed a new `apps/web/src/components/scheduled`
 * with shared, api and web all green, and `check-client-parity` refused it on
 * CI — correctly, because a new client surface has to say what the other two
 * clients do about it.
 *
 * The fix is not to remember seven commands. It is one command, kept honest by
 * being DERIVED FROM THE WORKFLOW rather than hand-listed: the step list below
 * is parsed out of `.github/workflows/checks.yml`, so a guard added to CI is
 * picked up here without anybody editing this file. A hand-maintained copy of a
 * list is a list that drifts, which is the same failure mode the guards
 * themselves exist to prevent.
 *
 * GITHUB_TOKEN: `check-open-lists` SKIPS without one, and a skip is not a pass.
 * This fills it from `gh auth token` when the variable is absent, and says so
 * when it cannot — a guard that silently checked nothing is worse than a guard
 * that failed.
 *
 * Usage:  pnpm check:guards
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(REPO_ROOT, ".github/workflows/checks.yml");

/**
 * The guard steps CI runs, in the order it runs them.
 *
 * Scraped rather than listed, so a guard added to the workflow is picked up
 * without anybody editing this file.
 *
 * A guard is a script that ASKS A QUESTION and can only answer yes or no:
 * either it is named `check-*`, or it is invoked with `--check` (the
 * parity-vector generator's read-only mode). That rule is what keeps the other
 * `node scripts/*.mjs` steps out — `dev-seed` and `ci-dev-vars` belong to the
 * theme-audit job, WRITE to a local database and a config file, and running
 * them as a side effect of "did I break a guard" would be a surprise nobody
 * asked for. A name-shaped rule rather than an exclusion list, because an
 * exclusion list is the thing that goes stale.
 */
function guardCommands() {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const found = [
    ...workflow.matchAll(/^\s*run:\s*(node scripts\/([\w-]+)\.mjs(\s+--check)?)\s*$/gm),
  ]
    .filter(([, , script, checkFlag]) => script.startsWith("check-") || checkFlag)
    .map(([, command]) => command);
  // De-duplicated, because a script used by more than one job would otherwise
  // run twice and report twice.
  return [...new Set(found)];
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const commands = guardCommands();
if (commands.length === 0) {
  console.error(
    "No guard steps found in .github/workflows/checks.yml — the scrape above " +
      "is structural, so a workflow refactor makes this script silently " +
      "vacuous rather than failing.",
  );
  process.exit(1);
}

const ghToken = token();
if (!ghToken) {
  console.warn(
    "! No GITHUB_TOKEN and `gh auth token` failed. Guards that reach GitHub " +
      "will SKIP, and a skip is not a pass.",
  );
}

let failed = 0;
for (const command of commands) {
  const [, ...args] = command.split(/\s+/);
  process.stdout.write(`\n▸ ${command}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: ghToken ? { ...process.env, GITHUB_TOKEN: ghToken } : process.env,
  });
  if (result.status !== 0) failed += 1;
}

console.log(
  `\n${commands.length - failed}/${commands.length} guard(s) passed.`,
);
process.exit(failed === 0 ? 0 : 1);
