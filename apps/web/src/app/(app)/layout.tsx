import type { Metadata } from "next";

import { LandingGate } from "@/components/for-you/landing-gate";
import { InviteBanner } from "@/components/invites/invite-banner";
import { HandoverBanner } from "@/components/ownership/handover-banner";
import { AppShell } from "@/components/shell/app-shell";
import { MfaGate } from "@/components/shell/mfa-gate";
import { PortalScope } from "@/components/shell/portal-scope";
import { UpdatePrompt } from "@/components/shell/update-prompt";
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
 * while marketing (Inter-global + .mkt-scope) is unaffected. PortalScope
 * (#116) extends the same scope to <body> while an (app) route is mounted,
 * so document.body portals resolve the tokens and Golos too; marketing
 * routes never mount it.
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
          {/* #339: ambient when an update is merely available; a full stop only
              below the server-set floor (D71). Mounted here so it covers every
              signed-in screen rather than one route. */}
          <UpdatePrompt />
          {/* #116: portals (sheets, dialogs, menus, the command palette) and
              the Toaster mount into document.body, outside this div — the
              scope must ALSO live on <body> or portaled surfaces lose every
              app token (transparent sheets, white borders in dark, Inter). */}
          <PortalScope classes={`${golosText.variable} app-scope`} />
          {/* app-scope: calm palette + Golos; font-sans now resolves to Golos
              here. h-svh so the shell owns the viewport. */}
          <div
            className={`${golosText.variable} app-scope font-sans h-svh`}
          >
            {/* #314: once the workspace requires a second factor and the
                grace window has passed, every company-scoped query 403s at
                once. This covers the shell with one sentence and the route
                that fixes it, rather than thirty broken panels. */}
            <MfaGate>
              <AppShell>{children}</AppShell>
            </MfaGate>
            {/* #109: ambient "you've been invited — Join" card (fixed, no
                layout shift; renders nothing when there's no pending invite). */}
            <InviteBanner />
            {/* #515: the same shape of problem one door further in — an
                ownership handover addressed to somebody whose navigation has
                no Team row. Mounted here rather than on a route because the
                named backup can be any role, including a bookkeeper who never
                leaves the billing screen. Silent unless it is theirs. */}
            <HandoverBanner />
          </div>
        </RealtimeProvider>
      </CompanyProvider>
    </AppProviders>
  );
}
