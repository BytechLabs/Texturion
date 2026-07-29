/**
 * #463 — the one surviving lead-chase switch, now a row among the per-person
 * notification settings rather than a card of its own.
 *
 * What is tested here is what this row could lie about. It is the only
 * workspace-wide control on a page of personal ones, so the scope line and the
 * member-can't-edit state are the assertions that matter; the rest of the page
 * is covered where it lives. The two-minute nudge is gone entirely (01209b5),
 * and a test asserts its absence — a re-added switch here would be a switch
 * the server no longer reads.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state: { role: string; lead_chase_crew_enabled: boolean } = {
  role: "owner",
  lead_chase_crew_enabled: false,
};

const mutate = vi.fn();

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", role: state.role }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    data: {
      id: "co-1",
      lead_chase_crew_enabled: state.lead_chase_crew_enabled,
    },
    isPending: false,
    isError: false,
  }),
  useUpdateCompany: () => ({ mutate, isPending: false }),
}));

import { LeadChaseRow } from "./lead-chase-row";

function render(next: Partial<typeof state> = {}): string {
  Object.assign(state, {
    role: "owner",
    lead_chase_crew_enabled: false,
    ...next,
  });
  return renderToStaticMarkup(<LeadChaseRow />).replaceAll("&#x27;", "'");
}

/**
 * True when the row's switch carries the real `disabled` attribute.
 *
 * NOT a substring search for "disabled": the Switch's class list always
 * carries Tailwind's `disabled:cursor-not-allowed` and `disabled:opacity-50`
 * variants, so a naive match reports the switch as disabled whatever the
 * component does.
 */
function switchDisabled(html: string): boolean {
  const tagStart = html.indexOf("<button");
  expect(tagStart, "no switch rendered").toBeGreaterThan(-1);
  const tag = html.slice(tagStart, html.indexOf(">", tagStart));
  return / disabled(=|\s|$)/.test(tag);
}

describe("LeadChaseRow", () => {
  it("says whose settings these are", () => {
    // Every other switch on this page is personal. A workspace-wide control
    // that does not announce itself is one a member changes for everybody
    // while believing they changed it for themselves.
    const html = render();
    expect(html).toContain("This one is for the whole workspace, not just you");
  });

  it("names the interval it actually uses", () => {
    expect(render()).toContain("Tell the whole crew after 5 minutes");
  });

  it("keeps the limits that are not switches", () => {
    // An owner who does not know about business hours reads silence at 7pm as
    // a bug. This sentence used to live in the card's footer; the card is gone
    // and the sentence is not.
    const html = render();
    expect(html).toContain("Business hours only");
    expect(html).toContain("turned their own notifications off");
  });

  it("no longer offers the two-minute nudge", () => {
    // 01209b5 removed the rung server-side. A switch for it here would be a
    // switch that changes nothing.
    expect(render()).not.toContain("Buzz again");
  });

  it("shows a member the setting but lets them change nothing", () => {
    const html = render({ role: "member" });
    // They still learn what the crew-wide alert is, and why it is not theirs.
    expect(html).toContain("Tell the whole crew after 5 minutes");
    expect(html).toContain("only owners and admins can change it");
    expect(switchDisabled(html)).toBe(true);
  });

  it("leaves the switch live for an owner", () => {
    expect(switchDisabled(render())).toBe(false);
  });
});
