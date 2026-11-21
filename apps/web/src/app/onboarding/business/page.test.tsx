/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import BusinessIdentityPage from "./page";

type AccountResponse = { data: { user: { email: string } } };

const getUser = vi.fn<() => Promise<AccountResponse>>();

vi.mock("@/lib/supabase/browser", () => ({
  getAccessToken: vi.fn(),
  getSupabaseBrowser: () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/api/onboarding", () => ({
  useSaveOnboardingRegistration: () => ({ isPending: false }),
}));
vi.mock("@/lib/analytics/events", () => ({
  trackOnboardingStepViewed: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
}));
vi.mock("../use-onboarding-state", () => {
  const company = { name: "Fixture Trades", country: "US" };
  return {
    useWizardStepGuard: () => ({
      ready: true,
      state: {
        status: "ready",
        companyId: "fixture-company",
        company,
        snapshot: { company },
      },
    }),
  };
});

afterEach(cleanup);

describe("business identity email prefill", () => {
  it.each([
    { emailEntered: "", expectedEmail: "owner@example.com" },
    { emailEntered: "work@example.com", expectedEmail: "work@example.com" },
  ])("preserves early edits and leaves $expectedEmail as the contact email", async ({ emailEntered, expectedEmail }) => {
    const account = Promise.withResolvers<AccountResponse>();
    getUser.mockReturnValueOnce(account.promise);
    render(<BusinessIdentityPage />);

    const legalName = screen.getByLabelText<HTMLInputElement>("Legal business name");
    const email = screen.getByLabelText<HTMLInputElement>("Contact email");
    fireEvent.change(legalName, { target: { value: "Harbour Electric LLC" } });
    fireEvent.change(email, { target: { value: emailEntered } });

    await act(async () => account.resolve({ data: { user: { email: "owner@example.com" } } }));

    expect(legalName.value).toBe("Harbour Electric LLC");
    expect(email.value).toBe(expectedEmail);
  });
});
