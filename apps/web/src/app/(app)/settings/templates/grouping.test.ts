/**
 * #274 — how a template list stops collapsing at thirty.
 *
 * Ordering fixes the picker; grouping fixes the settings list. What is pinned
 * here is the rule that makes grouping worth having in a workspace that has
 * not adopted it: an ungrouped template must not acquire an invented group.
 */
import { describe, expect, it } from "vitest";

import type { Template } from "@/lib/api/types";

import { groupTemplates } from "./grouping";

function template(name: string, category?: string | null): Template {
  return {
    id: name,
    name,
    body: "…",
    category: category ?? null,
    created_by: null,
    updated_by: null,
    updated_by_name: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

describe("groupTemplates", () => {
  it("gathers a category together under its own name", () => {
    const groups = groupTemplates([
      template("Quote sent", "Quoting"),
      template("On my way", "Dispatch"),
      template("Quote reminder", "Quoting"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Dispatch", "Quoting"]);
    expect(groups[1].rows.map((r) => r.name)).toEqual([
      "Quote sent",
      "Quote reminder",
    ]);
  });

  it("puts ungrouped templates last, under NO heading", () => {
    // Not a category called "Other". A heading invents a group the crew did
    // not make, and it would sit over every row in a shop that never uses
    // categories.
    const groups = groupTemplates([
      template("On my way"),
      template("Quote sent", "Quoting"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Quoting", null]);
    expect(groups[1].rows.map((r) => r.name)).toEqual(["On my way"]);
  });

  it("returns one unlabelled group when nothing is categorised", () => {
    // The common shop. It must look exactly like the flat list it was.
    const groups = groupTemplates([template("A"), template("B")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].rows).toHaveLength(2);
  });

  it("treats a blank category as no category", () => {
    // The API normalises "" to null, but a row that slipped through with
    // whitespace must not open a group headed by nothing.
    const groups = groupTemplates([template("A", "   "), template("B", "")]);
    expect(groups.map((g) => g.label)).toEqual([null]);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("loses no template, whatever the mix", () => {
    const rows = [
      template("A", "Quoting"),
      template("B"),
      template("C", "Dispatch"),
      template("D", "Quoting"),
    ];
    const total = groupTemplates(rows).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(rows.length);
  });
});
