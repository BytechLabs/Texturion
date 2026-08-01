import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #323 — every document says what it IS.
 *
 * The root cause the issue names: "`customer-gap-analysis.md` is historical
 * research and reads as current direction, which is the root of the #229
 * conflict." A document with no stated status is read as an instruction by
 * default, and this codebase is worked on by short-lived contexts that cannot
 * know better.
 *
 * Three statuses, because two would force a lie. A shipped build spec is
 * neither current direction (the code is) nor historical research (it was
 * executed and is accurate about what it built).
 *
 * This guard is the durable half. #323's devil's advocate is right that
 * "every decision must be updated on every change" collapses within a month —
 * so the rule is not that documents stay current, it is that they SAY which
 * they are. That costs one line at creation and nothing afterwards.
 */

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs");

/** How far into a file the status may sit. Title, blank line, status. */
const HEADER_LINES = 12;

const files = readdirSync(DOCS).filter((name) => name.endsWith(".md"));

describe("#323 every doc states whether it is direction or record", () => {
  it("finds the documents at all, so a moved folder cannot make this vacuous", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it.each(files)("%s carries a status in its first lines", (name) => {
    const header = readFileSync(join(DOCS, name), "utf8")
      .split("\n")
      .slice(0, HEADER_LINES)
      .join("\n");
    expect(
      /\*\*Status:/i.test(header),
      `docs/${name} has no "**Status:" line in its first ${HEADER_LINES} lines. ` +
        `A document with no stated status is read as an instruction by default, ` +
        `which is what filed #229 against a decision that had already refused it.`,
    ).toBe(true);
  });
});

describe("#323 the two documents that caused this say so loudest", () => {
  it("the gap analysis reads as research, not as direction", () => {
    const text = readFileSync(join(DOCS, "customer-gap-analysis.md"), "utf8");
    expect(text.slice(0, 2000)).toMatch(/HISTORICAL RESEARCH/);
  });

  it("the decision log claims authority over it", () => {
    // The tie-break has to be written down somewhere, or two documents
    // disagreeing is a coin toss decided by whoever read which one first.
    const text = readFileSync(join(DOCS, "DECISIONS.md"), "utf8");
    expect(text.slice(0, 1200)).toMatch(/Status: CURRENT DIRECTION/);
    expect(text.slice(0, 1200)).toMatch(/this file wins/i);
  });
});
