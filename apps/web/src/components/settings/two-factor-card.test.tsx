import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MfaState } from "@/lib/api/mfa";

/**
 * #314 — the two-factor card.
 *
 * The issue's devil's advocate is right that the real risk is lockout, not
 * friction, so what these pin is the anti-lockout copy: that somebody with no
 * recovery codes left is told to fix it rather than shown a statistic, and
 * that the not-enrolled state says what the setup actually involves before
 * asking for a commitment.
 */

let state: MfaState = {
  factors: [],
  enrolled: false,
  recovery_codes_remaining: 0,
  aal: "aal1",
};

vi.mock("@/lib/api/mfa", () => ({
  useMfa: () => ({ isPending: false, data: state, refetch: vi.fn() }),
  useIssueRecoveryCodes: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({ auth: { mfa: {} } }),
}));

import { TwoFactorCard } from "./two-factor-card";

const render = () => renderToStaticMarkup(<TwoFactorCard />);

describe("TwoFactorCard", () => {
  it("says what a stolen password actually costs, not that MFA is best practice", () => {
    state = { ...state, enrolled: false };
    // The reason to turn this on is specific to this product: somebody texting
    // your customers as you. Generic security copy gets skipped.
    expect(render()).toContain("texting your customers as you");
  });

  it("tells somebody what setup involves before asking them to start", () => {
    state = { ...state, enrolled: false };
    const html = render();
    expect(html).toContain("authenticator app");
    // And that backup codes are coming — the thing that makes it safe to do.
    expect(html).toContain("backup codes");
  });

  it("shows how many recovery codes are left once enrolled", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 7,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("Authenticator app is on");
    expect(html).toContain("7 recovery");
  });

  it("treats zero recovery codes as something to fix, not a number to read", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 0,
      aal: "aal2",
    };
    // Nought left is a lockout waiting for a lost phone.
    expect(render()).toContain("No recovery codes left");
  });

  it("offers a way to re-issue codes without turning the factor off", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 2,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("New recovery codes");
    expect(html).toContain("Turn off");
  });
});
