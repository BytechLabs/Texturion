/**
 * The banner reads GET /v1/registration only for the code prompt, the one
 * state that names a phone from the wizard data. Every other state is drawn
 * from the company view alone.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RegistrationUiState } from "./registration-ui-state";

const { registration, derived, company } = vi.hoisted(() => ({
  registration: vi.fn<(enabled?: boolean) => { data: undefined }>(() => ({
    data: undefined,
  })),
  derived: { current: { kind: "none" } as RegistrationUiState },
  company: { current: { data: undefined as unknown } },
}));

vi.mock("@/lib/api/registration", () => ({ useRegistration: registration }));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => company.current }));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));
vi.mock("@/components/settings/settings-link-guard", () => ({
  useCanOpenSettings: () => () => true,
}));
vi.mock("@/lib/use-now", () => ({ useNow: () => Date.now() }));
vi.mock("./registration-ui-state", () => ({
  deriveRegistrationUiState: () => derived.current,
}));

import { WorkspaceStatusBanner } from "./status-banner";

const view = {
  country: "US",
  us_texting_enabled: true,
  subscription_status: "active",
  numbers: [],
  registration: { brand: null, campaign: null },
};

beforeEach(() => {
  registration.mockClear();
  company.current = { data: view };
});

describe("WorkspaceStatusBanner registration read", () => {
  it("asks for the wizard data only when the code prompt shows", () => {
    derived.current = { kind: "otp_pending" };
    expect(renderToStaticMarkup(<WorkspaceStatusBanner />)).toContain(
      'href="/onboarding/setting-up"',
    );
    expect(registration).toHaveBeenLastCalledWith(true);
  });

  it("leaves it alone in every other state, and while the company loads", () => {
    for (const kind of ["none", "approved", "payment_issue"] as const) {
      derived.current = { kind } as RegistrationUiState;
      renderToStaticMarkup(<WorkspaceStatusBanner />);
      expect(registration, kind).toHaveBeenLastCalledWith(false);
    }
    company.current = { data: undefined };
    renderToStaticMarkup(<WorkspaceStatusBanner />);
    expect(registration).toHaveBeenLastCalledWith(false);
  });
});
