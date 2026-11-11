/**
 * #722: every machine with entry effects names what proves a second pass
 * sends nothing. See entry-only-proofs.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENTRY_ONLY_PROOFS } from "./entry-only-proofs";
import { ALL_MACHINES } from "./index";

const REPO = join(__dirname, "..", "..", "..", "..");

const withEntryEffects = ALL_MACHINES.filter(
  (machine) => Object.keys(machine.entryEffects).length > 0,
).map((machine) => machine.id);

describe("entry-only proofs (#722)", () => {
  it("checks at least one machine", () => {
    // A filter that silently matches nothing would pass every test below.
    expect(withEntryEffects.length, "no machine with entry effects was found").toBeGreaterThan(0);
  });

  it("covers every machine that has entry effects", () => {
    const missing = withEntryEffects.filter((id) => !(id in ENTRY_ONLY_PROOFS));
    expect(missing, `machines with entry effects and no proof: ${missing.join(", ")}`).toEqual([]);
  });

  it("names only machines that exist and have entry effects", () => {
    const known = new Set(ALL_MACHINES.map((machine) => machine.id));
    const unknown = Object.keys(ENTRY_ONLY_PROOFS).filter((id) => !known.has(id));
    expect(unknown, `proofs for machines that do not exist: ${unknown.join(", ")}`).toEqual([]);

    const noEffects = Object.keys(ENTRY_ONLY_PROOFS).filter(
      (id) => known.has(id) && !withEntryEffects.includes(id),
    );
    expect(noEffects, `proofs for machines with no entry effects: ${noEffects.join(", ")}`).toEqual([]);
  });

  it("points every proof at a test file that holds the title, or says why stamps are enough", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const id of withEntryEffects) {
      const proof = ENTRY_ONLY_PROOFS[id];
      if (!proof) continue;
      checked += 1;
      if ("stampsOnly" in proof) {
        if (proof.stampsOnly.trim().length < 20) problems.push(`${id}: stampsOnly needs a real reason`);
        continue;
      }
      const file = join(REPO, proof.test);
      if (!existsSync(file)) {
        problems.push(`${id}: ${proof.test} does not exist`);
        continue;
      }
      if (proof.title.trim().length < 10) {
        problems.push(`${id}: the title is too short to identify a test`);
        continue;
      }
      if (!readFileSync(file, "utf8").includes(proof.title)) {
        problems.push(`${id}: ${proof.test} has no test titled "${proof.title}"`);
      }
    }
    console.log(`entry-only proofs: checked ${checked} of ${withEntryEffects.length} machines with entry effects`);
    expect(checked, "no proof was checked").toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
