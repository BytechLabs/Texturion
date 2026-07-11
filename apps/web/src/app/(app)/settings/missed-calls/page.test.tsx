import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CompanyView, Usage } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  includedMinutes: number;
  voiceEnabled: boolean;
} = { includedMinutes: 2500, voiceEnabled: true };

const company = {
  name: "Ace Plumbing",
  mctb_enabled: false,
  mctb_message: null,
  forward_to_cell: null,
  numbers: [],
  // #133: the member-visible module state lives on the company view.
  get enabled_modules() {
    return state.voiceEnabled ? ["voice"] : [];
  },
} as unknown as CompanyView;

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: company,
    refetch: vi.fn(),
  }),
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/billing", () => ({
  useModules: () => ({
    isPending: false,
    isError: false,
    data: { modules: [{ id: "voice", enabled: state.voiceEnabled }] },
  }),
}));
vi.mock("@/lib/api/usage", () => ({
  useUsage: () => ({
    isPending: false,
    isError: false,
    data: {
      voice: {
        used_minutes: 0,
        included_minutes: state.includedMinutes,
        overage_billed: true,
      },
    } as unknown as Usage,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));
vi.mock("@/lib/api/calls", () => ({
  useCallCell: () => ({
    isPending: false,
    isError: false,
    data: { call_cell_e164: null, verified: false },
  }),
  useSetCallCell: () => ({ isPending: false, mutate: vi.fn() }),
  useVerifyCallCell: () => ({ isPending: false, mutate: vi.fn() }),
}));

import MissedCallsSettingsPage from "./page";

function render(): string {
  return renderToStaticMarkup(<MissedCallsSettingsPage />);
}

/**
 * Finding 4 + D36: the forward-to-cell copy must state the honest allowance
 * AND what happens past it — extra minutes bill at 1¢ each up to the spending
 * cap, where forwarding pauses (no silent drop at the allowance, no surprise
 * bill past the cap). The figure must derive from the plan's allowance
 * (voice.included_minutes = PLAN_VOICE_MINUTES) rather than being a retyped
 * literal.
 */
describe("/settings/missed-calls forwarding fair-use honesty", () => {
  it("states the allowance, the 1¢/min overage, and the pause-at-cap behaviour", () => {
    state.voiceEnabled = true;
    state.includedMinutes = 2500;
    const html = render();
    expect(html).toContain("2,500");
    expect(html).toContain("calling minutes a month");
    // D38: one pool, both directions — the copy must say what drains it.
    expect(html).toContain("calls you place from the app");
    expect(html).toContain("1¢ each");
    expect(html).toContain("spending cap");
    expect(html).toContain("calling pauses");
    expect(html).toContain("missed-call text");
  });

  it("does not promise unlimited/uncapped forwarding", () => {
    state.voiceEnabled = true;
    state.includedMinutes = 2500;
    const html = render();
    expect(html).not.toContain("don't cost extra");
    expect(html).not.toContain("unlimited");
  });

  it("derives the figure from the plan allowance, not a hardcoded count", () => {
    state.voiceEnabled = true;
    state.includedMinutes = 555; // off-value proves the surface reads the prop
    const html = render();
    expect(html).toContain("555");
    expect(html).not.toContain("2,500 minutes");
  });
});

/**
 * D38/#132: the member's own outbound-call cell is manageable here — not only
 * via the Call button's first-use dialog — and the copy carries the privacy
 * promise (the customer sees the business number, never the cell).
 */
describe("/settings/missed-calls — your cell for outbound calls", () => {
  it("renders the per-member cell card with the privacy promise", () => {
    state.voiceEnabled = true;
    const html = render();
    expect(html).toContain("Your cell for outbound calls");
    expect(html).toContain("never your cell");
    expect(html).toContain("every person on the crew sets their own");
  });

  it("stays behind the voice add-on gate like the rest of the page", () => {
    state.voiceEnabled = false;
    const html = render();
    expect(html).not.toContain("Your cell for outbound calls");
    state.voiceEnabled = true;
  });
});
