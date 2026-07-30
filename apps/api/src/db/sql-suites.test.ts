/**
 * Every SQL assertion suite runs in CI (#342, found while adding one).
 *
 * `supabase/tests/*.test.sql` is where the database's own behaviour is
 * asserted — teardown ordering, gate arithmetic, grant posture, the things
 * that cannot be reached from a stubbed vitest suite. CI runs them through the
 * one hand-maintained list in `scripts/db-test-all.mjs`.
 *
 * A hand-maintained list of files is a list that falls behind the files. When
 * this was written, NINE suites existed and none of them ran: audit_log,
 * calls_feature, delete_account, offboard_member, purge_workspace,
 * registration_caps, route_limits, spam_freeze_and_grace_ledger and
 * workspace_closure. Each was written, passed once locally, and then sat there
 * green by default — the same failure shape as a spam thread nobody opens.
 *
 * So the list is checked rather than trusted. Adding a suite and forgetting to
 * register it now fails here, in the test run that already gates every push.
 *
 * THE LIST MOVED, AND THIS TEST IS WHY THAT WAS SAFE. It used to live in a
 * `db:test:all` npm script that concatenated all 62 suites with `&&` — 8,228
 * characters against a Windows command-line limit of about 8,191, so adding the
 * 62nd made the whole chain unrunnable locally while staying green in CI. The
 * runner script has no such ceiling. Its `assertNoneMissed` makes the same
 * check, but only for whoever runs the suites; this one runs in the vitest gate
 * on every push, which is where an unregistered suite gets caught first.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const TESTS_DIR = join(REPO_ROOT, "supabase", "tests");
const RUNNER = join(REPO_ROOT, "scripts", "db-test-all.mjs");

function suiteFiles(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.sql"))
    .sort();
}

function suitesInCi(): string[] {
  const source = readFileSync(RUNNER, "utf8");
  const list = /const SUITES = \[([^\]]*)\]/.exec(source);
  if (!list) {
    throw new Error(
      `Could not find the SUITES array in ${RUNNER}. If the runner was ` +
        `restructured, this test has to be repointed at wherever the list now ` +
        `lives — silently parsing nothing would make every assertion below pass.`,
    );
  }
  return [...list[1].matchAll(/"([a-z0-9_]+)"/g)]
    .map((match) => `${match[1]}.test.sql`)
    .sort();
}

describe("the SQL suites CI actually runs", () => {
  it("covers every file in supabase/tests", () => {
    const onDisk = suiteFiles();
    const registered = new Set(suitesInCi());
    const unrun = onDisk.filter((name) => !registered.has(name));

    // A suite that exists and never runs is worse than no suite: it reads as
    // coverage in a review and asserts nothing.
    expect(unrun).toEqual([]);
  });

  it("names no suite that does not exist", () => {
    const onDisk = new Set(suiteFiles());
    const missing = suitesInCi().filter((name) => !onDisk.has(name));

    // The other direction: a renamed or deleted suite leaves a path that fails
    // the whole run with a shell redirect error rather than an assertion.
    expect(missing).toEqual([]);
  });

  it("lists each suite exactly once", () => {
    const registered = suitesInCi();
    const duplicated = registered.filter(
      (name, index) => registered.indexOf(name) !== index,
    );
    expect(duplicated).toEqual([]);
  });
});
