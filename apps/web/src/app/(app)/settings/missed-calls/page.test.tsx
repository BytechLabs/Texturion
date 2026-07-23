import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CompanyView, Usage } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  includedMinutes: number;
} = { includedMinutes: 2500 };

// #134/D42: calling is included on every plan — enabled_modules carries no
// 'voice' anymore, and the page must render its cards regardless.
// Mutable so #192 tests can flip the text-back state per render.
const company = {
  name: "Ace Plumbing",
  mctb_enabled: false,
  mctb_message: null,
  voicemail_greeting: null,
  call_screening: "flag",
  cnam_display_name: null,
  caller_id_lookup: true,
  // #193: server-resolved effective caller ID (defaults to the company name).
  caller_id_effective: "Ace Plumbing",
  caller_id_source: "company_name",
  cnam_submitted_at: null,
  numbers: [],
  enabled_modules: [],
} as unknown as CompanyView;

function setTextBack(enabled: boolean, message: string | null) {
  company.mctb_enabled = enabled;
  company.mctb_message = message;
}

/** #193: seed the caller ID state the server would resolve. */
function setCallerId(
  custom: string | null,
  submittedAt: string | null = null,
) {
  company.cnam_display_name = custom;
  company.caller_id_effective = custom ?? "Ace Plumbing";
  company.caller_id_source = custom ? "custom" : "company_name";
  company.cnam_submitted_at = submittedAt;
}

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

/**
 * #192 founder contract: the toggle decides IF the text-back fires; a product
 * default always exists server-side; the owner's text overrides only when
 * non-blank. No Save button anywhere on the card (autosave), and the message
 * input exists only while the toggle is on.
 */
describe("/settings/missed-calls — #192 text-back settings contract", () => {
  it("toggle OFF hides the message input, preview, and any Save button", () => {
    setTextBack(false, null);
    const html = render();
    expect(html).toContain("Text back missed calls");
    expect(html).not.toContain("Your text-back message");
    expect(html).not.toContain("What the caller gets");
    expect(html).not.toContain("Save text-back");
  });

  it("toggle ON with no custom text: empty input, default as placeholder, default previewed", () => {
    setTextBack(true, null);
    const html = render();
    // The input is empty (never prefilled with the default as if authored)…
    expect(html).toContain("Your text-back message");
    // …the default rides the placeholder…
    expect(html).toContain(
      "placeholder=\"Sorry we missed your call! This is {business_name}.",
    );
    // …and the preview shows the default as the caller would get it.
    expect(html).toContain("This is Ace Plumbing.");
    expect(html).toContain("Saves as you type");
  });

  it("toggle ON with custom text: input carries the owner's message and the preview merges it", () => {
    setTextBack(true, "You reached {business_name}. Text us your street address.");
    const html = render();
    expect(html).toContain("You reached Ace Plumbing. Text us your street address.");
  });

  it("has NO Save button in the enabled state either (autosave only)", () => {
    setTextBack(true, null);
    const html = render();
    expect(html).not.toContain("Save text-back");
    // The other cards keep their explicit saves — only the text-back card
    // moved to autosave.
    expect(html).toContain("Save greeting");
  });
});

/**
 * #193 contract: the caller ID defaults to the company name and the card
 * shows the server-resolved EFFECTIVE value; changing it is an explicit
 * Change action (no always-editable field), and a fresh submission surfaces
 * the honest carrier-propagation note.
 */
describe("/settings/missed-calls — #193 caller ID default + change flow", () => {
  it("unset: shows the effective name with the company-name attribution and a Change action", () => {
    setCallerId(null);
    const html = render();
    expect(html).toContain("Ace Plumbing");
    expect(html).toContain("Using your company name");
    expect(html).toContain("Change");
    // No always-editable input in view mode — changing is deliberate.
    expect(html).not.toContain('id="cnam-name"');
  });

  it("custom: shows the override and attributes it as custom", () => {
    setCallerId("ACE PLUMBERS");
    const html = render();
    expect(html).toContain("ACE PLUMBERS");
    expect(html).toContain("Custom display name");
    setCallerId(null);
  });

  it("a fresh submission shows the pending carrier-propagation note", () => {
    setCallerId(null, new Date(Date.now() - 60_000).toISOString());
    const html = render();
    expect(html).toContain("Update submitted");
    expect(html).toContain("1 to 3 days");
    setCallerId(null);
  });

  it("an old submission shows no pending note (propagation window passed)", () => {
    setCallerId(null, new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString());
    const html = render();
    expect(html).not.toContain("Update submitted");
    setCallerId(null);
  });
});
