import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #251 — the capacity headline agrees with the body it summarises.
 *
 * ## Why this exists
 *
 * `docs/CAPACITY.md` §0 is the part a CEO or a prospect's CTO actually reads:
 * what breaks first, and how many unknowns are left. §2 is the table those
 * unknowns live in.
 *
 * On 2026-08-17 the Realtime fan-out row was measured locally and moved out of
 * §2, leaving one row. §0 still said "exactly two candidates left" and "neither
 * can be measured on a laptop" — a claim the same document disproved 380 lines
 * further down. For a day the summary contradicted the body.
 *
 * That is structural rather than careless: a summary goes stale exactly when
 * the body it summarises is being improved, and nobody re-reads the top of a
 * long document after editing the middle of it. So the agreement is checked
 * rather than remembered.
 *
 * ## What it asserts
 *
 * That the number §0 claims is the number §2 lists. It deliberately does NOT
 * assert which unknowns those are or what the measurements say — that is the
 * document's job, and a test that pinned the findings would become a ceiling on
 * changing them (this repo has shipped several of those).
 */

const DOC = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "CAPACITY.md",
);

/** The §2 table's rows: lines that open a bolded cell inside the table. */
function openUnknowns(source: string): string[] {
  const start = source.indexOf("## 2. What is NOT measured");
  if (start === -1) return [];
  const rest = source.slice(start);
  const end = rest.indexOf("\n### ");
  const table = end === -1 ? rest : rest.slice(0, end);
  return table
    .split("\n")
    .filter((line) => /^\|\s*\*\*/.test(line))
    .map((line) => line.slice(0, 60));
}

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

describe("#251 the capacity headline matches the table it summarises", () => {
  const source = readFileSync(DOC, "utf8");

  it("found the document and both sections, so a pass means something", () => {
    // A path that resolves to nothing makes every assertion below vacuously
    // true, which is the failure mode of every file-derived check here.
    expect(source.length).toBeGreaterThan(5000);
    expect(source).toContain("## 0. The headline");
    expect(source).toContain("## 2. What is NOT measured");
  });

  it("counts the same number of open unknowns in both places", () => {
    const rows = openUnknowns(source);
    expect(
      rows.length,
      "§2's table has no rows at all — either every unknown is closed (in " +
        "which case §0 should say so) or the parser stopped matching the table",
    ).toBeGreaterThan(0);

    const claim = /candidates? left|candidate left/.exec(source);
    expect(claim, "§0 no longer states how many candidates are left").toBeTruthy();

    const headline = source.slice(source.indexOf("## 0. The headline"));
    const stated = /exactly (ZERO|ONE|TWO|THREE|FOUR|zero|one|two|three|four)\s*\n?\s*candidates?/i.exec(
      headline.slice(0, 4000),
    );
    expect(
      stated,
      "§0 must say 'exactly <word> candidate(s)' so this can be checked",
    ).toBeTruthy();

    const claimed = WORDS[stated![1].toLowerCase()];
    expect(
      claimed,
      `§0 says exactly ${stated![1].toLowerCase()} open candidate(s); §2's ` +
        `table lists ${rows.length}:\n  ${rows.join("\n  ")}\n\n` +
        `The headline is what a prospect reads. When a row is measured and ` +
        `moved out of §2, §0 has to move with it.`,
    ).toBe(rows.length);
  });
});
