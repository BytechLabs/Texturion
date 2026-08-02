import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #474 — the dev seed and the SQL suite must not claim the same phone number.
 *
 * `phone_numbers_e164_uq` is GLOBAL, not per-company, so a seeded workspace and
 * a test fixture holding the same number collide on any database both have run
 * against. The error names a unique constraint, so the person who hits it goes
 * looking for a defect in the migration they just wrote.
 *
 * CI never sees this — it starts from an empty database — so the whole cost
 * lands on local development, which is exactly why the guard has to live in a
 * suite that does run. This is a static read of both sides; it needs no
 * database.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const E164 = /\+1[0-9]{10}/g;

function numbersIn(file: string): string[] {
  return readFileSync(file, "utf8").match(E164) ?? [];
}

const seedNumbers = new Set(numbersIn(join(REPO, "scripts", "dev-seed.mjs")));

const TESTS_DIR = join(REPO, "supabase", "tests");
const fixtureNumbers = new Map<string, string[]>();
for (const name of readdirSync(TESTS_DIR).filter((f) => f.endsWith(".sql"))) {
  for (const number of numbersIn(join(TESTS_DIR, name))) {
    const files = fixtureNumbers.get(number) ?? [];
    if (!files.includes(name)) files.push(name);
    fixtureNumbers.set(number, files);
  }
}

describe("#474 the seed and the SQL fixtures use disjoint numbers", () => {
  it("reads real numbers from both sides, so the guard is not silently blind", () => {
    // If a refactor moves either side's numbers behind a helper, these counts
    // collapse and the assertion below starts passing for the wrong reason.
    expect(seedNumbers.size).toBeGreaterThanOrEqual(5);
    expect(fixtureNumbers.size).toBeGreaterThanOrEqual(50);
  });

  it("shares no number between the seed and any fixture", () => {
    const collisions = [...seedNumbers]
      .filter((n) => fixtureNumbers.has(n))
      .map((n) => `${n} also in ${fixtureNumbers.get(n)!.join(", ")}`);
    expect(collisions).toEqual([]);
  });

  it("keeps the seed out of the 555 block the fixtures own", () => {
    // The fixtures spread across several area codes but always NXX 555. Naming
    // the rule as well as the symptom is what stops the next person picking
    // another 555 number and reintroducing this one collision at a time.
    // +1 NPA NXX LINE — "+1" is 2 chars, NPA is 3, so NXX starts at index 5.
    const in555 = [...seedNumbers].filter((n) => n.slice(5, 8) === "555");
    expect(in555).toEqual([]);
  });
});
