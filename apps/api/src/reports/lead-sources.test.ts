/**
 * #301 — conversations by source.
 *
 * LR-2 is the one that decides whether this report is honest. #301's fourth
 * Acceptance line — "reporting distinguishes attributed from unknown, and
 * never infers silently" — is not a caveat on the report, it is the report's
 * most important number. A contractor reading "Google 40, Truck 30, Yard sign
 * 30" concludes the yard sign is worth a third of their business; if two
 * hundred other conversations had no source, the honest sentence is that they
 * know about a third of their customers and are guessing about the rest. Those
 * are completely different decisions about next month's spend.
 */
import { describe, expect, it } from "vitest";

import {
  buildLeadSourceReport,
  coverageNote,
  LOW_COVERAGE,
  type LeadSourceRollupRow,
} from "./lead-sources";

const TRUCK = "11111111-0000-4000-8000-000000000001";
const GOOGLE = "22222222-0000-4000-8000-000000000002";

function rows(...list: LeadSourceRollupRow[]): LeadSourceRollupRow[] {
  return list;
}

describe("#301 conversations by source", () => {
  it("LR-1: ranks by size, and splits how we came to believe each one", () => {
    // A line ringing is a fact about our own infrastructure; a tech tapping a
    // chip is a report of what a customer said. Both are worth having and
    // they are not the same kind of thing.
    const report = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 30, by_person: 2, total: 32 },
        { lead_source_id: GOOGLE, name: "Google", by_number: 0, by_person: 40, total: 40 },
      ),
      30,
    );
    expect(report.sources.map((s) => s.name)).toEqual(["Google", "Truck"]);
    expect(report.sources[1]).toMatchObject({
      by_number: 30,
      by_person: 2,
      total: 32,
    });
    expect(report.total).toBe(72);
    expect(report.coverage).toBe(1);
  });

  it("LR-2: unknown is a row, not an omission", () => {
    // THE ONE THAT MATTERS. Dropping the unattributed conversations would make
    // every percentage in the table a percentage of the wrong denominator, and
    // the table would look complete.
    const report = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 10, by_person: 0, total: 10 },
        // An unattributed row has NEITHER sub-count: no origin, so both filters
        // skip it. Its `total` is the group's own count, which is exactly why
        // `total` is a column and not a sum.
        { lead_source_id: null, name: null, by_number: 0, by_person: 0, total: 90 },
      ),
      30,
    );
    expect(report.unknown).toBe(90);
    expect(report.total).toBe(100);
    expect(report.coverage).toBe(0.1);
    // And the unknown bucket is NOT in the ranked list, where it would read as
    // a source somebody could go and spend money on.
    expect(report.sources.map((s) => s.name)).toEqual(["Truck"]);
  });

  it("LR-3: thin coverage says so, in a sentence somebody can act on", () => {
    // A ranking the unknown bucket could reorder completely is a hint, not an
    // answer — and presenting it without saying so is the silent inference
    // #301 forbids.
    const thin = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 3, by_person: 0, total: 3 },
        { lead_source_id: null, name: null, by_number: 0, by_person: 0, total: 97 },
      ),
      30,
    );
    const note = coverageNote(thin);
    expect(note).toContain("3%");
    expect(note).toContain("97");
    // It names the fix, because "your data is bad" without one is just blame.
    expect(note).toMatch(/put a source on the lines you advertise/i);
  });

  it("LR-3b: good coverage says nothing, or the warning becomes furniture", () => {
    const good = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 80, by_person: 0, total: 80 },
        { lead_source_id: null, name: null, by_number: 0, by_person: 0, total: 20 },
      ),
      30,
    );
    expect(good.coverage).toBeGreaterThan(LOW_COVERAGE);
    expect(coverageNote(good)).toBeNull();
  });

  it("LR-4: no conversations is not the same as no attribution", () => {
    // Coverage is null rather than 0 for an empty window. Zero would render as
    // "you know where 0% of your customers came from" to a workspace that has
    // simply had a quiet month, which is a scolding rather than a finding.
    const empty = buildLeadSourceReport([], 30);
    expect(empty.total).toBe(0);
    expect(empty.coverage).toBeNull();
    expect(coverageNote(empty)).toBeNull();
  });

  it("LR-5: an archived source still names itself for the period it ran", () => {
    // The whole reason archiving exists instead of deleting. A report about
    // last quarter has to be able to say "Yard sign" even after the yard sign
    // came down.
    const report = buildLeadSourceReport(
      rows({ lead_source_id: TRUCK, name: "Yard sign", by_number: 5, by_person: 0, total: 5 }),
      90,
    );
    expect(report.sources[0].name).toBe("Yard sign");
  });

  it("LR-6: a source with no conversations is not a row", () => {
    // A list of every source ever created, most of them zero, buries the three
    // that matter. The table answers "where did they come from", not "what
    // have we ever written down".
    const report = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 4, by_person: 0, total: 4 },
        { lead_source_id: GOOGLE, name: "Google", by_number: 0, by_person: 0, total: 0 },
      ),
      30,
    );
    expect(report.sources).toHaveLength(1);
  });

  it("LR-7: equal counts keep a stable order", () => {
    // Two sources tied at seven should not swap places between page loads,
    // which reads as data changing when nothing did.
    const first = buildLeadSourceReport(
      rows(
        { lead_source_id: GOOGLE, name: "Google", by_number: 7, by_person: 0, total: 7 },
        { lead_source_id: TRUCK, name: "Truck", by_number: 7, by_person: 0, total: 7 },
      ),
      30,
    );
    const reversed = buildLeadSourceReport(
      rows(
        { lead_source_id: TRUCK, name: "Truck", by_number: 7, by_person: 0, total: 7 },
        { lead_source_id: GOOGLE, name: "Google", by_number: 7, by_person: 0, total: 7 },
      ),
      30,
    );
    expect(first.sources.map((s) => s.name)).toEqual(["Google", "Truck"]);
    expect(reversed.sources.map((s) => s.name)).toEqual(["Google", "Truck"]);
  });
});
