import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import SignupPage from "@/app/(auth)/signup/page";
import BusinessIdentityPage from "@/app/onboarding/business/page";

import { authLocale } from "./auth-locale";
import { LocaleProvider } from "./provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("@/env", () => ({ publicEnv: { NEXT_PUBLIC_API_URL: "https://api.example.test" } }));
vi.mock("@/lib/api/onboarding", () => ({ useSaveOnboardingRegistration: () => ({ isPending: false }) }));
vi.mock("@/app/onboarding/use-onboarding-state", () => ({
  useWizardStepGuard: () => ({
    ready: true,
    state: {
      status: "ready",
      companyId: "workspace",
      company: { country: "CA", locale: null },
      registration: null,
      snapshot: { company: { country: "CA", us_texting_enabled: true } },
    },
  }),
}));

it("renders French signup when the language hint overrides the browser preference", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider deviceLocale={authLocale("fr-CA", "en-US")}>
      <SignupPage />
    </LocaleProvider>,
  );
  expect(html).toContain("Créer le compte");
  expect(html).not.toContain("Create account");
});

it("renders the French business step and selects French for customer texts", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider deviceLocale={authLocale(null, "fr-CA,en;q=0.5")}>
      <BusinessIdentityPage />
    </LocaleProvider>,
  );
  expect(html).toContain("Parlez-nous de votre entreprise");
  expect(html).toContain("Vos clients recevront leurs textos en");
  expect(html).toContain('data-value="fr-CA"');
  expect(html).toContain(">Français<");
});
