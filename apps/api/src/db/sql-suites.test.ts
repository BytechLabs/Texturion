/**
 * Every SQL assertion suite runs in CI (#342, found while adding one).
 *
 * `supabase/tests/*.test.sql` is where the database's own behaviour is
 * asserted — teardown ordering, gate arithmetic, grant posture, the things
 * that cannot be reached from a stubbed vitest suite. CI runs them through one
 * hand-maintained `db:test:all` script in the root package.json.
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
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import packageJson from "../../../../package.json" with { type: "json" };

const TESTS_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "tests",
);

function suiteFiles(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.sql"))
    .sort();
}

function suitesInCi(): string[] {
  const script = (packageJson as { scripts: Record<string, string> }).scripts[
    "db:test:all"
  ];
  return [...script.matchAll(/supabase\/tests\/([a-z0-9_]+\.test\.sql)/g)]
    .map((match) => match[1])
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
