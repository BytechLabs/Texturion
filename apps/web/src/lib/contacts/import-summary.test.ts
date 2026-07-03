import { describe, expect, it } from "vitest";

import type { ImportResult } from "@/lib/api/types";

import { summarizeImport } from "./import-summary";

function result(over: Partial<ImportResult>): ImportResult {
  return { imported: 0, updated: 0, skipped: 0, errors: [], ...over };
}

describe("summarizeImport (D20 §3.2/§3.3 import summary)", () => {
  it("renders the imported/updated/skipped headline", () => {
    const summary = summarizeImport(
      result({ imported: 3, updated: 1, skipped: 2 }),
    );
    expect(summary.headline).toBe("3 new, 1 updated, 2 skipped.");
  });

  it("reports no errors for a clean import", () => {
    const summary = summarizeImport(result({ imported: 5 }));
    expect(summary.hasErrors).toBe(false);
    expect(summary.visibleErrors).toEqual([]);
    expect(summary.hiddenErrorCount).toBe(0);
  });

  it("surfaces each skipped row with its reason", () => {
    const errors = [
      { row: 1, reason: "invalid phone: (empty)" },
      { row: 4, reason: "duplicate phone in file: +14165550100" },
    ];
    const summary = summarizeImport(
      result({ imported: 2, skipped: 2, errors }),
    );
    expect(summary.hasErrors).toBe(true);
    expect(summary.visibleErrors).toEqual(errors);
    expect(summary.hiddenErrorCount).toBe(0);
  });

  it("caps the visible error list and counts the overflow", () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({
      row: i + 1,
      reason: `invalid phone: bad-${i}`,
    }));
    const summary = summarizeImport(result({ skipped: 7, errors }), 5);
    expect(summary.visibleErrors).toHaveLength(5);
    expect(summary.hiddenErrorCount).toBe(2);
    expect(summary.visibleErrors[0]).toEqual({
      row: 1,
      reason: "invalid phone: bad-0",
    });
  });
});
