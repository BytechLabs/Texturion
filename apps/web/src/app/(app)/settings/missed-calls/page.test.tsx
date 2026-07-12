import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CompanyView, Usage } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  includedMinutes: number;
} = { includedMinutes: 2500 };

// #134/D42: calling is included on every plan — enabled_modules carries no
// 'voice' anymore, and the page must render its cards regardless.
const company = {
  name: "Ace Plumbing",
  mctb_enabled: false,
  mctb_message: null,
  voicemail_greeting: null,
  call_screening: "flag",
  cnam_display_name: null,
  caller_id_lookup: true,
  numbers: [],
  enabled_modules: [],
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

import CallingSettingsPage from "./page";

function render(): string {
  return renderToStaticMarkup(<CallingSettingsPage />);
}

/**
 * D36/D43: the fair-use line must state the honest allowance AND the 1¢/min
 * overage, with the figure derived from the plan's allowance
 * (voice.included_minutes = PLAN_VOICE_MINUTES), never a retyped literal.
 */
describe("/settings/missed-calls (Calling) fair-use honesty", () => {
  it("states the allowance and the 1¢ overage", () => {
    state.includedMinutes = 2500;
    const html = render();
    expect(html).toContain("2,500");
    expect(html).toContain("calling minutes a month");
    expect(html).toContain("1¢ each");
    expect(html).toContain("spending cap");
  });

  it("does not promise unlimited/uncapped calling", () => {
    state.includedMinutes = 2500;
    const html = render();
    expect(html).not.toContain("don't cost extra");
    expect(html).not.toContain("unlimited");
  });

  it("derives the figure from the plan allowance, not a hardcoded count", () => {
    state.includedMinutes = 555; // off-value proves the surface reads the prop
    const html = render();
    expect(html).toContain("555");
    expect(html).not.toContain("2,500 minutes");
  });
});

/**
 * D43: cell forwarding is DELETED — no forward card, no cell card, no
 * verification flow. The page is the browser-calling surface: text-back,
 * voicemail greeting, call screening, caller ID.
 */
describe("/settings/missed-calls — D43 Calling surface", () => {
  it("renders the four calling cards", () => {
    const html = render();
    expect(html).toContain("Text back a missed call");
    expect(html).toContain("Voicemail");
    expect(html).toContain("Call screening");
    expect(html).toContain("Caller ID");
  });

  it("carries no trace of cell forwarding or the retired add-on gate", () => {
    const html = render();
    expect(html).not.toContain("Ring your cell");
    expect(html).not.toContain("Your cell for outbound calls");
    expect(html).not.toContain("forward");
    expect(html).not.toContain("add-on");
    expect(html).not.toContain('href="/settings/billing"');
  });

  it("previews the spoken default greeting from the company name", () => {
    const html = render();
    expect(html).toContain("You&#x27;ve reached Ace Plumbing");
    expect(html).toContain("after the beep");
  });

  it("offers the three screening choices with the divert-to-voicemail promise", () => {
    const html = render();
    expect(html).toContain("Label suspicious calls");
    expect(html).toContain("Send suspicious calls to voicemail");
    expect(html).toContain("misflagged can still leave a message");
  });
});
