import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #251 — every required capacity axis stays visible in the plan.
 *
 * The first guard counted rows in §2 and checked that the headline repeated
 * that number. It could prove two copies of the same omission agreed: hosted
 * Realtime and the managed pooler disappeared from the table, the headline
 * said "exactly one", and the test was green while prose below admitted both
 * numbers were still unknown.
 *
 * The acceptance matrix is now the contract. It names the required axes and
 * requires each to carry a rerun command, a tested bound, a ceiling statement,
 * and an acceptance state. Findings may change freely; an axis cannot vanish.
 */

const DOC = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "CAPACITY.md",
);

const MATRIX_START = "<!-- capacity-matrix:start -->";
const MATRIX_END = "<!-- capacity-matrix:end -->";
const HEADERS = [
  "Axis ID",
  "What",
  "Rerun",
  "Tested bound",
  "Ceiling",
  "Acceptance state",
] as const;
const REQUIRED_AXES = [
  "query",
  "webhook",
  "pooler",
  "realtime",
  "durable-object",
  "degradation",
  "cost",
] as const;

type MatrixRow = Record<(typeof HEADERS)[number], string>;

function cells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function matrix(source: string): { headers: string[]; rows: MatrixRow[] } {
  const start = source.indexOf(MATRIX_START);
  const end = source.indexOf(MATRIX_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("capacity acceptance matrix markers are missing or reversed");
  }
  const lines = source
    .slice(start + MATRIX_START.length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (lines.length < 3) throw new Error("capacity acceptance matrix has no data rows");

  const headers = cells(lines[0]);
  const rows = lines.slice(2).map((line) => {
    const values = cells(line);
    if (values.length !== headers.length) {
      throw new Error(`capacity matrix row has ${values.length} cells: ${line}`);
    }
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]]),
    ) as MatrixRow;
  });
  return { headers, rows };
}

describe("#251 required capacity-axis matrix", () => {
  const source = readFileSync(DOC, "utf8");
  const parsed = matrix(source);

  it("found the real document and the complete matrix schema", () => {
    // Prevent a wrong path or a malformed parser from making the assertions
    // below pass vacuously.
    expect(source.length).toBeGreaterThan(5000);
    expect(source).toContain("## 0. The headline");
    expect(source).toContain("## 2. What is NOT measured");
    expect(parsed.headers).toEqual(HEADERS);
  });

  it("names every required axis exactly once", () => {
    const ids = parsed.rows.map((row) => row["Axis ID"]);
    expect(new Set(ids).size, "duplicate capacity axis in acceptance matrix").toBe(
      ids.length,
    );
    expect([...ids].sort()).toEqual([...REQUIRED_AXES].sort());
  });

  it("gives every axis a rerun, bound, ceiling statement, and state", () => {
    for (const row of parsed.rows) {
      expect(row.What, `${row["Axis ID"]}: missing scenario description`).not.toBe("");
      expect(row.Rerun, `${row["Axis ID"]}: rerun must be one code-formatted command`).toMatch(
        /^`[^`]+`$/,
      );
      expect(row["Tested bound"], `${row["Axis ID"]}: missing tested bound`).not.toBe("");
      expect(row.Ceiling, `${row["Axis ID"]}: missing ceiling statement`).not.toBe("");
      expect(
        row["Acceptance state"],
        `${row["Axis ID"]}: missing acceptance state`,
      ).not.toBe("");
    }
  });

  it("keeps the externally blocked deployment axes explicit", () => {
    const byId = new Map(parsed.rows.map((row) => [row["Axis ID"], row]));
    for (const id of ["pooler", "realtime", "durable-object", "degradation", "cost"]) {
      const row = byId.get(id)!;
      expect(`${row.Ceiling} ${row["Acceptance state"]}`).toMatch(
        /unknown|required/i,
      );
    }
  });

  it("does not turn lower bounds into a first-break claim", () => {
    const start = source.indexOf("## 0. The headline");
    const end = source.indexOf("\n## 1.", start);
    const headline = source.slice(start, end);
    expect(headline).toContain("What breaks first is therefore still unknown");
    expect(headline).not.toMatch(/exactly\s+(one|two|three|four)\s+candidates?/i);
    expect(source.slice(0, start)).toContain("#251 remains open");
  });
});
