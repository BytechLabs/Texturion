/**
 * @vitest-environment happy-dom
 *
 * #301 — where these customers came from, on the home surface.
 *
 * LC-2 is the one that decides whether this panel is honest. #301's fourth
 * Acceptance line — "reporting distinguishes attributed from unknown, and
 * never infers silently" — either happens here or does not. A ranking built on
 * a third of the conversations can be reordered completely by the other two
 * thirds, and an owner acting on it spends real money on an artefact. So the
 * unknown count is a ROW in the same list and the same scale as the sources,
 * because that is the only presentation in which it visibly competes with
 * them.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportRef } = vi.hoisted(() => ({
  reportRef: { current: null as unknown },
}));

vi.mock("@/lib/api/reports", () => ({
  useLeadSourceReport: () => ({ isLoading: false, data: reportRef.current }),
}));

import {
  leadingSentence,
  LeadSourcesCard,
  visibleRows,
} from "./lead-sources-card";
import { makeTranslate } from "@/i18n/provider";

/**
 * #228: both helpers now compose their sentence through the catalogue, so the
 * test reads it the same way rather than pinning a literal that has moved.
 */
const t = makeTranslate("en");

afterEach(cleanup);
beforeEach(() => {
  reportRef.current = null;
});

function source(name: string, total: number) {
  return {
    lead_source_id: name,
    name,
    by_number: total,
    by_person: 0,
    total,
  };
}

function report(over: Record<string, unknown> = {}) {
  return {
    days: 30,
    sources: [source("Truck", 30), source("Google", 10)],
    unknown: 10,
    total: 50,
    coverage: 0.8,
    note: null,
    ...over,
  } as never;
}

describe("#301 where your customers come from", () => {
  it("LC-1: the headline is a sentence, not a chart", () => {
    // An owner does not act on a bar chart; they act on "most of your work
    // came from the truck this month".
    reportRef.current = report();
    render(<LeadSourcesCard />);
    expect(screen.getByText(/most of the work you can account for/i).textContent)
      .toMatch(/Truck — 30 of 40/);
  });

  it("LC-2: the unknowns are a row in the same list, not a footnote", () => {
    // THE ONE THAT MATTERS. Ten unattributed conversations sitting beside a
    // source with ten is the whole point: they are competing, and an owner can
    // see it.
    reportRef.current = report();
    render(<LeadSourcesCard />);
    const unknown = screen.getByText("Don't know");
    expect(unknown).toBeTruthy();
    // In the list, with the sources.
    expect(unknown.closest("ul")).toBe(screen.getByText("Truck").closest("ul"));
  });

  it("LC-3: a thin ranking prints the server's caveat above everything", () => {
    // Computed server-side and printed verbatim, so a phone and a laptop
    // cannot disagree about how much of this to believe.
    reportRef.current = report({
      coverage: 0.2,
      note: "You know where 20% of these customers came from.",
    });
    render(<LeadSourcesCard />);
    expect(screen.getByRole("status").textContent).toMatch(/20%/);
  });

  it("LC-4: a quiet month says nothing at all", () => {
    // Not a zero state and not an encouraging placeholder. A workspace with no
    // conversations is told nothing.
    reportRef.current = report({ sources: [], unknown: 0, total: 0, coverage: null });
    const { container } = render(<LeadSourcesCard />);
    expect(container.textContent).toBe("");
  });

  it("LC-5: no sources set up gets a way to start, not a table of reproach", () => {
    // A table whose only row reads "unknown: 40" is a scolding. One sentence
    // about the fix, and a link to it.
    reportRef.current = report({ sources: [], unknown: 40, total: 40, coverage: 0 });
    render(<LeadSourcesCard />);
    expect(screen.getByText(/haven't told us yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /set one up/i })).toBeTruthy();
    // And no bar chart of a single bleak row.
    expect(screen.queryByText("Don't know")).toBeNull();
  });

  it("LC-6: a leader too small to lead gets no sentence", () => {
    // "Most of your work came from X" at 25% is simply false, and the table
    // says it better than a wrong sentence would.
    const spread = {
      days: 30,
      sources: [source("A", 10), source("B", 9), source("C", 9), source("D", 8)],
      unknown: 0,
      total: 36,
      coverage: 1,
      note: null,
    } as never;
    expect(leadingSentence(spread, t)).toBeNull();
  });

  it("LC-7: a long tail is folded into one row rather than listed", () => {
    // A list of eleven channels is a list nobody reads to the bottom.
    const many = {
      days: 30,
      sources: [
        source("A", 10),
        source("B", 9),
        source("C", 8),
        source("D", 7),
        source("E", 6),
        source("F", 5),
      ],
      unknown: 0,
      total: 45,
      coverage: 1,
      note: null,
    } as never;
    const rows = visibleRows(many, t);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual({ name: "2 more", total: 11 });
  });
});
