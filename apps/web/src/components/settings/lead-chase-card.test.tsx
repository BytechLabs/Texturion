/**
 * #388 — the two switches that decide whether an unanswered lead gets chased.
 *
 * Both non-obvious rules are here because both are ways this card could lie
 * about what the product will do:
 *
 *   - the crew-wide switch is dead while chasing is off, because the second
 *     rung is only ever reached through the first. Leaving it live lets an
 *     owner turn on something that cannot fire, and then wonder why the crew
 *     never hears anything;
 *   - a member sees the settings and cannot change them, rather than not
 *     seeing them — the copy explains why their phone buzzed twice, which is
 *     information they need even though the switch is not theirs.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state: {
  role: string;
  lead_chase_enabled: boolean;
  lead_chase_crew_enabled: boolean;
} = {
  role: "owner",
  lead_chase_enabled: true,
  lead_chase_crew_enabled: false,
};

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", role: state.role }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    data: {
      id: "co-1",
      lead_chase_enabled: state.lead_chase_enabled,
      lead_chase_crew_enabled: state.lead_chase_crew_enabled,
    },
    isPending: false,
    isError: false,
  }),
  useUpdateCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { LeadChaseCard } from "./lead-chase-card";

function render(next: Partial<typeof state> = {}): string {
  Object.assign(state, {
    role: "owner",
    lead_chase_enabled: true,
    lead_chase_crew_enabled: false,
    ...next,
  });
  return renderToStaticMarkup(<LeadChaseCard />).replaceAll("&#x27;", "'");
}

/**
 * True when the switch following `label` carries the real `disabled`
 * attribute.
 *
 * NOT a substring search for "disabled": the Switch's class list always
 * carries Tailwind's `disabled:cursor-not-allowed` and `disabled:opacity-50`
 * variants, so a naive match reports every switch as disabled and the test
 * passes whatever the component does.
 */
function switchDisabled(html: string, label: string): boolean {
  const at = html.indexOf(label);
  expect(at, `no switch labelled ${label}`).toBeGreaterThan(-1);
  const tagStart = html.indexOf("<button", at);
  expect(tagStart, `no switch element after ${label}`).toBeGreaterThan(-1);
  const tag = html.slice(tagStart, html.indexOf(">", tagStart));
  return / disabled(=|\s|$)/.test(tag);
}

describe("LeadChaseCard", () => {
  it("says whose settings these are", () => {
    // The card above it on this page is per-person. A workspace-wide control
    // that does not announce itself is one an owner changes for everybody
    // while believing they changed it for themselves.
    const html = render();
    expect(html).toContain("Applies to everyone in the workspace");
  });

  it("names the intervals it actually uses", () => {
    const html = render();
    expect(html).toContain("Buzz again after 2 minutes");
    expect(html).toContain("Tell the whole crew after 5 minutes");
  });

  it("kills the crew switch when chasing is off entirely", () => {
    const off = render({ lead_chase_enabled: false });
    expect(switchDisabled(off, "Tell the whole crew")).toBe(true);
  });

  it("leaves the crew switch usable when chasing is on", () => {
    const on = render({ lead_chase_enabled: true });
    expect(switchDisabled(on, "Tell the whole crew")).toBe(false);
  });

  it("shows a member the settings but lets them change nothing", () => {
    const html = render({ role: "member" });
    // They still learn why their phone went off twice.
    expect(html).toContain("Buzz again after 2 minutes");
    expect(switchDisabled(html, "Buzz again after")).toBe(true);
  });

  it("states the limits that are not switches", () => {
    // Business hours and the per-person preference are hard rules the owner
    // cannot override from here, and an owner who does not know that will
    // read silence at 7pm as a bug.
    const html = render();
    expect(html).toContain("Only during your business hours");
    expect(html).toContain("turned their own notifications off");
  });
});
