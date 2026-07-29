/**
 * #283 — the kill-switch list exists in two places, so it is asserted in one.
 *
 * `scripts/ops/set-flag.mjs` is plain ESM with no build step and cannot import
 * the Worker's TypeScript, so it carries its own copy of the kill-switch keys.
 * That duplication is fine; a SILENT duplication is not. If the two drift, the
 * script stops demanding a `--note` for a switch that takes a subsystem away
 * from every customer, and stops warning the operator what they are about to
 * do — both failures of exactly the moment the script exists for.
 *
 * Same guard the liveness table uses for wrangler's cron list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { killSwitchKeys } from "./registry";

const REPO_ROOT = join(fileURLToPath(new URL("../../../..", import.meta.url)));

describe("#283 — the ops script and the registry agree", () => {
  it("lists exactly the kill switches the code declares", () => {
    const script = readFileSync(join(REPO_ROOT, "scripts/ops/set-flag.mjs"), "utf8");

    const match = /const KILL_SWITCHES = \[([^\]]*)\]/.exec(script);
    expect(
      match,
      "set-flag.mjs no longer declares KILL_SWITCHES — this guard cannot find " +
        "the list it protects and must be updated, not deleted.",
    ).not.toBeNull();

    const inScript = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(
      inScript,
      "the ops script's kill-switch list has drifted from registry.ts. The " +
        "script uses it to require a --note and to warn before taking a " +
        "subsystem away from every customer; a missing key silently skips both.",
    ).toEqual(killSwitchKeys().sort());
  });

  it("documents every kill switch in the rollback runbook", () => {
    // A switch nobody can find at 2am is a switch that does not exist. The
    // runbook is the first thing read during an incident, so the roster has to
    // be complete there too.
    const runbook = readFileSync(join(REPO_ROOT, "docs/ROLLBACK.md"), "utf8");
    for (const key of killSwitchKeys()) {
      expect(
        runbook.includes(key),
        `${key} is a kill switch with no entry in docs/ROLLBACK.md`,
      ).toBe(true);
    }
  });
});
