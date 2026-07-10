import type { Metadata } from "next";

import { LandingGate } from "@/components/for-you/landing-gate";
import { InviteBanner } from "@/components/invites/invite-banner";
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

export const metadata: Metadata = {
  // Pin the signed-in app's own title template + a plain default on the group
  // layout, so tab titles stay stable regardless of the marketing root's copy:
  // core routes that supply a title read "%s · Loonext" (for-you, tasks, and
  // the metadata-only contacts layout), and untitled routes read "Loonext"
  // rather than inheriting the marketing home's descriptive default. The (app)
  // group stays crawlable-config (it is auth-gated by middleware), so no robots
  // override here.
  title: { default: "Loonext", template: "%s · Loonext" },
};

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
            {/* #109: ambient "you've been invited — Join" card (fixed, no
                layout shift; renders nothing when there's no pending invite). */}
            <InviteBanner />
          </div>
        </RealtimeProvider>
      </CompanyProvider>
    </AppProviders>
  );
}
