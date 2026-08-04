"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SettingsPage } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { useActiveCompany } from "@/lib/company/provider";

import { settingsAccessFor, type SettingsAccess } from "./section-access";

import type { SettingsSection } from "@/components/settings/settings-nav";

/**
 * #515 — the route gate. Wraps every settings page so a typed URL is answered
 * by the same rule that draws the nav, rather than by whatever the page
 * happens to render.
 *
 * What a refused person gets, and why it is this and not the two obvious
 * alternatives:
 *
 *   NOT a redirect. A redirect throws away where they were trying to go, so
 *   the one thing they now want to know — was that link wrong, or am I not
 *   allowed — is the one thing it refuses to say. It also lies to anyone
 *   following a link somebody sent them.
 *   NOT a blank pane. Indistinguishable from a slow load, which turns a clear
 *   "no" into "this app is broken".
 *
 * So: the section's own heading position, a plain sentence, and one way
 * onward. The left nav stays mounted around it (this sits inside SettingsShell,
 * not outside), so a desktop reader keeps every row that IS theirs in view and
 * a phone reader gets the button.
 */
export function SettingsSectionGate({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { role } = useActiveCompany();
  const access: SettingsAccess = settingsAccessFor(pathname, role);

  if (access.kind === "index" || access.kind === "allowed") {
    return <>{children}</>;
  }

  return <NoAccess section={access.kind === "denied" ? access.section : null} />;
}

function NoAccess({ section }: { section: SettingsSection | null }) {
  return (
    <SettingsPage
      title={
        section
          ? `You don't have access to ${section.label}`
          : "You don't have access to this page"
      }
      // Names the people who can actually fix it. That is not the rank check
      // #315 removed — owner and admin are the roles holding `team.manage`,
      // and changing what somebody's role reaches IS team.manage. Sending a
      // member to a bookkeeper because the page said "billing" would be
      // technically about billing and practically a dead end.
      description="Ask an owner or an admin if you need it — they're the ones who can change what your role reaches."
    >
      <Button asChild variant="outline">
        <Link href="/settings">Back to your settings</Link>
      </Button>
    </SettingsPage>
  );
}
