/**
 * #238 / #285 — the conformance statement cannot outlive its evidence.
 *
 * `docs/ACCESSIBILITY.md` is written to be handed to a buyer. Every row in its
 * verified table names the test that enforces the claim, and that structure is
 * the only thing separating it from the kind of statement that describes what
 * somebody once intended.
 *
 * The failure mode is quiet and specific: a test gets renamed or deleted in a
 * refactor, the document keeps citing it, and a claim that nothing enforces
 * goes on being made to customers. Nobody notices, because a markdown file has
 * no build.
 *
 * So this gives it one. AS-1 is the load-bearing assertion — every path the
 * document cites must exist. AS-2 and AS-3 stop the document being made true
 * by emptying it.
 *
 * What this deliberately does NOT check: whether the named tests are any good.
 * That is what the break sweeps are for, and claiming otherwise here would be
 * the same overreach the statement itself refuses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(process.cwd(), "..", "..");
const STATEMENT = join(REPO_ROOT, "docs", "ACCESSIBILITY.md");

const doc = readFileSync(STATEMENT, "utf8");
const contract = readFileSync(
  join(REPO_ROOT, "docs", "APP-LAYOUT-V2.md"),
  "utf8",
);
const design = readFileSync(join(REPO_ROOT, "docs", "DESIGN.md"), "utf8");
const elevation = readFileSync(
  join(REPO_ROOT, "docs", "APP-UI-ELEVATION.md"),
  "utf8",
);

/** The verified table, sliced out of the document. */
function verifiedTable(): string {
  const start = doc.indexOf("## Verified mechanically");
  const end = doc.indexOf("## Specified, implemented");
  expect(start, "the verified table is where this test thinks").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return doc.slice(start, end);
}

/** Its claim rows — a leading `| **N.N.N**`, so headers and rules do not count. */
function verifiedRows(): string[] {
  return verifiedTable()
    .split("\n")
    .filter((line) => /^\|\s*\*\*\d+\.\d+\.\d+\*\*/.test(line));
}

/** The `Enforced by` column: every backticked path in the verified table. */
function citedPaths(): string[] {
  const paths = new Set<string>();
  for (const match of verifiedTable().matchAll(/`([^`]+\.(?:ts|mjs))`/g)) {
    paths.add(match[1]);
  }
  return [...paths];
}

describe("#238/#285 the accessibility statement is backed by real tests", () => {
  it("AS-1: every test the statement cites still exists", () => {
    // The quiet failure: a rename leaves the document citing a file that is
    // gone, and a claim nothing enforces goes on being made to buyers.
    const missing = citedPaths().filter(
      (path) => !existsSync(join(REPO_ROOT, path)),
    );

    expect(
      missing,
      "docs/ACCESSIBILITY.md claims these enforce a WCAG criterion, and they " +
        "do not exist. Either restore them, or move the row down into " +
        "'Specified, implemented, not yet mechanically verified' — a buyer is " +
        "reading this:\n  " + missing.join("\n  "),
    ).toEqual([]);
  });

  it("AS-2: no claim disappears from the verified table", () => {
    // A document made true by deleting its claims — the cheapest way to make
    // AS-1 pass is to stop claiming anything.
    //
    // The floor is TODAY'S COUNT, not a comfortable number below it. Written
    // loosely first (">= 4 cited paths") this test was decorative: dropping
    // the contrast row left four other paths and passed, which the break
    // sweep caught. A floor beneath the real value is not a floor.
    //
    // Rows rather than paths, because one file can enforce several criteria —
    // `theme-audit.mjs` covers three — so a row can vanish while its path
    // survives in another row.
    // Raised from 8/5 to 11/6 when #238's focus work landed 2.4.7, 1.4.11 and
    // 2.4.11. Raising it is not bookkeeping: left at 8, the three new rows
    // could each be deleted in silence, and the comment above would be a lie
    // the next reader trusts.
    expect(verifiedRows().length).toBeGreaterThanOrEqual(11);
    expect(citedPaths().length).toBeGreaterThanOrEqual(6);
  });

  it("AS-3: it still states what it has NOT verified", () => {
    // The half that makes the rest credible. A statement that quietly dropped
    // its gaps section would read as a stronger claim than we can support,
    // which is the failure mode that costs a customer's trust rather than a
    // build.
    expect(doc).toContain("Not verified — native apps");
    expect(doc).toContain("Known gaps");
    // The specific admission that matters most, because it is the one a buyer
    // would otherwise assume the other way.
    expect(doc).toMatch(/No TalkBack or VoiceOver pass has been performed/);
  });

  it("AS-4: every criterion cited is a real WCAG number", () => {
    // A typo'd success criterion is worse than a missing one: it looks
    // checkable, and whoever checks it finds nothing and assumes the document
    // is decorative.
    const numbers = [...doc.matchAll(/\*\*(\d+\.\d+\.\d+)\*\*/g)].map((m) => m[1]);
    expect(numbers.length).toBeGreaterThan(4);
    for (const number of numbers) {
      const [principle, guideline] = number.split(".").map(Number);
      // WCAG has four principles, and no guideline numbering runs past 5.
      expect(principle, `${number} names principle ${principle}`).toBeLessThanOrEqual(4);
      expect(principle).toBeGreaterThanOrEqual(1);
      expect(guideline, `${number} names guideline ${guideline}`).toBeLessThanOrEqual(5);
    }
  });

  it("AS-5: one document owns the accessibility contract", () => {
    expect(contract).toContain(
      "Accessibility — canonical product contract (WCAG 2.2 Level AA)",
    );
    expect(design).toContain("docs/APP-LAYOUT-V2.md` §7 owns");
    expect(elevation).toContain(
      "docs/APP-LAYOUT-V2.md` §7 is the canonical",
    );
    expect(contract).not.toContain(
      "Inherits every guardrail in **APP-UI-ELEVATION §6** unchanged",
    );
    expect(design).not.toContain("WCAG 2.1 AA");
    expect(elevation).not.toContain("WCAG 2.1 AA");
    expect(contract).not.toContain("Accessibility (WCAG 2.1 AA)");
    expect(design).not.toMatch(/(?:hit|touch) targets?\s*(?:≥|>=|at least)\s*44px/i);
    expect(elevation).not.toMatch(
      /(?:hit|touch) targets?\s*(?:≥|>=|at least)\s*44px/i,
    );
  });
});
