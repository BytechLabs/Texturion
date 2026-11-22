// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";

import NumberStepPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/analytics/events", () => ({
  trackOnboardingStepViewed: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
}));

vi.mock("../use-onboarding-state", () => ({
  useWizardStepGuard: () => {
    const draft = { name: "Test Plumbing", country: "CA" };
    return {
      ready: true,
      state: {
        status: "ready",
        draft,
        company: null,
        snapshot: { company: null, registration: null, canManageRegistration: false, draft },
      },
    };
  },
}));

afterEach(cleanup);

it.each([
  ["en", "Loonext can't place emergency calls. Use your phone to dial 911."],
  ["fr-CA", "Loonext ne peut pas passer d’appels d’urgence. Composez le 911 sur votre téléphone."],
])("shows the emergency number during signup in %s", (locale, warning) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider userLocale={locale}>
        <NumberStepPage />
      </LocaleProvider>
    </QueryClientProvider>,
  );

  expect(screen.getByText(warning)).toBeInstanceOf(HTMLElement);
});
