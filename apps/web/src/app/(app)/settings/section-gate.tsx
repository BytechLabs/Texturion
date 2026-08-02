"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SettingsPage } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOwnership } from "@/lib/api/ownership";
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

  // #332's recovery valve runs through the Team page, and the person it is for
  // is usually not somebody who holds `team.manage`. Asked separately, below.
  if (access.kind === "denied" && access.section.id === "team") {
    return <SuccessionException section={access.section}>{children}</SuccessionException>;
  }

  return <NoAccess section={access.kind === "denied" ? access.section : null} />;
}

/**
 * The one place a role is not the whole answer.
 *
 * #332 lets an owner name a BACKUP OWNER — the person who can take the
 * workspace over when the owner is gone, which is the entire point of naming
 * one. The database accepts any active member for that job (a spouse on a
 * `member` role is the ordinary case), and every action is gated server-side on
 * the specific user id rather than on a role, deliberately: "the person
 * entitled to act is not a ROLE — it is one specific user."
 *
 * The buttons that act on it live inside OwnershipCard on the Team page. There
 * is now a dedicated /ownership route outside settings, which is where the
 * emails point and where a nominee should end up — but the card is still
 * mounted here, and every ownership email sent BEFORE that route existed is
 * still sitting in somebody's inbox pointing at /settings/team. Gate `team` on
 * `team.manage` alone and those links become a refusal aimed at exactly the
 * person the mechanism was built for. A security fix that quietly bricks the
 * recovery path is a worse bug than the one it closes.
 *
 * Delete this the day OwnershipCard leaves the Team page and the old links have
 * aged out — not before, and not by assuming they have.
 *
 * So the gate asks the server the second question it already answers on a
 * `workspace.access` route: is this caller party to a handover. Nothing is
 * derived here — `i_am_backup` and `pending.mine` are booleans the API computes,
 * for the same reason the card's buttons are.
 *
 * Scoped to the two people the flow belongs to. OwnershipCard also shows an
 * in-flight handover to uninvolved colleagues (they are well placed to notice
 * one that should not be happening), and that audience does not survive this
 * gate — reaching them is an ambient-notice job, not a reason to reopen the
 * roster to the whole crew for the length of a transfer.
 */
function SuccessionException({
  section,
  children,
}: Readonly<{ section: SettingsSection; children: React.ReactNode }>) {
  const ownership = useOwnership();

  if (ownership.isPending) {
    // Named nothing, because we do not yet know which answer we are loading —
    // showing either the page or the refusal early would flash the wrong one.
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  const state = ownership.data;
  const party =
    state !== undefined && (state.i_am_backup || state.pending?.mine === true);

  return party ? <>{children}</> : <NoAccess section={section} />;
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
