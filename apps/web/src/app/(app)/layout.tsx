import { LandingGate } from "@/components/for-you/landing-gate";
import { AppShell } from "@/components/shell/app-shell";
import { golosText } from "@/lib/app/fonts";
import { CompanyProvider } from "@/lib/company/provider";
import { RealtimeProvider } from "@/lib/realtime/provider";

import { AppProviders } from "../app-providers";

/**
 * The signed-in application: company context (X-Company-Id source), one
 * realtime channel per company, and the PORTAL-UX shell (a calm left sidebar,
 * no top bar). Middleware guarantees a session before anything here renders.
 *
 * FONT + TOKEN SCOPE (PORTAL-UX §4): the `.app-scope` root here mounts Golos
 * Text (golosText.variable → --font-golos) and turns on the calm petrol token
 * layer for the whole (app) subtree — the same subtree-scoping the (marketing)
 * layout uses for its own faces. So the app reads in Golos over the calm palette
 * while marketing (Inter-global + .mkt-scope) is unaffected; nothing outside
 * this subtree resolves --font-golos or the app-scope tokens.
 *
 * Feature tracks mount their pages inside this group (/inbox, /contacts,
 * /templates, /settings) — no page stubs live here by design.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <CompanyProvider>
        <RealtimeProvider>
          {/* D23: send members to /for-you on their first app screen. */}
          <LandingGate />
          {/* app-scope: calm palette + Golos; font-sans now resolves to Golos
              here. h-svh so the shell owns the viewport. */}
          <div
            className={`${golosText.variable} app-scope font-sans h-svh`}
          >
            <AppShell>{children}</AppShell>
          </div>
        </RealtimeProvider>
      </CompanyProvider>
    </AppProviders>
  );
}
