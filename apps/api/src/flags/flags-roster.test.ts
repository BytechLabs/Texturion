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
    const scriptSource = readFileSync(
      join(REPO_ROOT, "scripts/ops/set-flag.mjs"),
      "utf8",
    );

    // Comments out FIRST. The scrape below pulls every quoted string out of the
    // array text, and it cannot tell an element from a key sitting inside a
    // `//` comment — so commenting a switch out leaves it scraped, the rosters
    // match, and the ops script silently loses the ability to disable that
    // subsystem. `kill:realtime` is the one that makes the cost concrete: a
    // lever nobody can pull at 2am, guarded by a test that says it is there.
    //
    // Importing the array instead would be better and is not available: the
    // script ends in a top-level `await runScript(...)`, so importing it runs
    // the CLI.
    const script = scriptSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

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

  it("gives every kill switch a ROW in the rollback table", () => {
    // A switch nobody can find at 2am is a switch that does not exist, and the
    // table is what somebody reads at 2am: what the switch does, and what
    // still works once it is thrown.
    //
    // #519: this asked whether the key appeared ANYWHERE in the file, which is
    // the "mentioned rather than documented" shape. Proven by deleting the
    // table row for `kill:outbound-send` — the switch that silences every
    // outbound text — and watching the guard stay green, because the key was
    // still named in a prose sentence and an example command further down.
    // Both of those tell an operator nothing about what survives.
    const runbook = readFileSync(join(REPO_ROOT, "docs/ROLLBACK.md"), "utf8");
    const rows = runbook
      .split("\n")
      .filter((line) => line.trimStart().startsWith("|"));

    for (const key of killSwitchKeys()) {
      const row = rows.find((line) => line.includes(`\`${key}\``));
      expect(
        row,
        `${key} is a kill switch with no row in the docs/ROLLBACK.md table. ` +
          `A mention in prose is not a runbook entry — the row is what says ` +
          `what it does and what keeps working.`,
      ).toBeDefined();
      // And the row has to SAY something in both columns. A key added to the
      // table with empty cells satisfies "has a row" while telling the
      // operator exactly as much as no row at all.
      const cells = row!
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell !== "");
      expect(
        cells.length,
        `${key}'s runbook row has no description of what it does or what ` +
          `survives it: ${row}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
