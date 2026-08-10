"use client";

import {
  handoverPromptHeadline,
  handoverPromptIsUrgent,
  viewerHandoverPrompt,
} from "@loonext/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { useOwnership } from "@/lib/api/ownership";

/**
 * #515 — the handover comes to the person it is happening to.
 *
 * A page they can reach is only half the fix: the nominee has to KNOW. The
 * emails do that job for people who read email the day it arrives; this is for
 * everyone else. Mounted in the (app) layout rather than a route, so it finds
 * a bookkeeper on the billing screen just as readily as a member in the inbox
 * — deliberately, because either of them can be the named backup.
 *
 * Modelled on InviteBanner (#109), the existing answer to exactly this shape
 * of problem: something is waiting for you on a page your navigation does not
 * offer. Like that one it LINKS rather than acting — a business changing hands
 * is not a decision to take from a floating card in the corner of a screen.
 *
 * Never dismissible, and that is the one place it departs from InviteBanner:
 * an invitation you ignore costs you a workspace you were not in yet, and one
 * of these is on a clock that ends with a business having a different owner.
 * It disappears when the state does.
 */
export function HandoverBanner() {
  const t = useT();
  const ownership = useOwnership();
  const pathname = usePathname();
  // Already there: a "Review" button pointing at the page you are reading is
  // the app not knowing where you are.
  if (pathname === "/ownership") return null;
  if (!ownership.data) return null;

  const prompt = viewerHandoverPrompt(ownership.data);
  // Being the named backup is a standing arrangement that may sit unused for
  // years — surfacing it here would be a permanent nag. It gets the page and
  // the email, not the banner.
  if (!prompt || !handoverPromptIsUrgent(prompt)) return null;

  return (
    <div
      role="status"
      aria-label={handoverPromptHeadline(prompt)}
      // Same berth as InviteBanner: above the mobile tab bar, bottom-left of
      // the desktop content column, never over the sidebar. Both cards showing
      // at once is possible and stacks readably — they are different sizes and
      // one of them is about to be acted on.
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-app-card border border-amber-500/40 bg-app-paper px-4 py-3 shadow-lg lg:bottom-4"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <p className="min-w-0 text-sm text-app-ink">
        {handoverPromptHeadline(prompt)}
      </p>
      <Button asChild size="sm" className="shrink-0">
        <Link href="/ownership">{t("misc.ownershipReview")}</Link>
      </Button>
    </div>
  );
}
