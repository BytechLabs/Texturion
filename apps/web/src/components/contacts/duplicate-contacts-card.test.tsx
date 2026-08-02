/**
 * #246 — the duplicates card.
 *
 * What is pinned is what this card could get wrong in a way nobody would
 * notice: appearing when there is nothing to act on, and hiding the merge from
 * somebody who cannot perform it. The dialog's copy is covered where the
 * decision is actually made — see the direction sentence below.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DuplicatePair } from "@/lib/api/contacts";

const state: { pairs: DuplicatePair[] } = { pairs: [] };

vi.mock("@/lib/api/contacts", () => ({
  useDuplicateContacts: () => ({ data: { data: state.pairs } }),
  useMergeContacts: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DuplicateContactsCard } from "./duplicate-contacts-card";

function pair(overrides: Partial<DuplicatePair> = {}): DuplicatePair {
  return {
    contact_a: "a",
    name_a: "Mike",
    phone_a: "+14155550501",
    contact_b: "b",
    name_b: "Michael Chen",
    phone_b: "+14155550502",
    reason: "same digits",
    ...overrides,
  };
}

function render(pairs: DuplicatePair[], canMerge = true): string {
  state.pairs = pairs;
  return renderToStaticMarkup(
    <DuplicateContactsCard canMerge={canMerge} />,
  ).replaceAll("&#x27;", "'");
}

describe("DuplicateContactsCard", () => {
  it("renders nothing at all when there are no duplicates", () => {
    // The common workspace. Its contacts page must look exactly as it did —
    // an empty "no duplicates" card is chrome that describes nothing.
    expect(render([])).toBe("");
  });

  it("names both records the way somebody recognises them", () => {
    const html = render([pair()]);
    expect(html).toContain("Mike");
    expect(html).toContain("Michael Chen");
    // Formatted, not E.164: this is the number as it appears everywhere else.
    expect(html).toContain("(415) 555-0501");
  });

  it("falls back to the number when a record has no name", () => {
    // A phantom contact from a typo usually has nothing else to show.
    const html = render([pair({ name_a: null })]);
    expect(html).toContain("(415) 555-0501");
  });

  it("says WHY the pair is suggested", () => {
    // A suggestion somebody cannot verify is one they learn to dismiss.
    expect(render([pair()])).toContain("same digits");
  });

  it("counts the pairs once there is more than one", () => {
    const html = render([pair(), pair({ contact_a: "c", contact_b: "d" })]);
    expect(html).toContain("2 pairs");
  });

  it("offers no merge to somebody who cannot perform one", () => {
    // The finding is still worth showing — knowing the duplicates exist is
    // what gets somebody to ask an admin.
    const html = render([pair()], false);
    expect(html).toContain("Michael Chen");
    expect(html).not.toContain("Merge");
  });
});
