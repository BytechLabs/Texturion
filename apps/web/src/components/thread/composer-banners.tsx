"use client";

import { toast } from "sonner";

import { CallButton } from "@/components/calls/call-button";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { useBillingPortal } from "@/lib/api/billing";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import type { ComposerBanner } from "./composer-banner";

/**
 * The G5 banner card that REPLACES the composer: full-width tinted card, one
 * sentence + optional action. Copy is verbatim from DESIGN.md G5.
 */
export function ComposerBannerCard({
  banner,
  thread,
}: {
  banner: NonNullable<ComposerBanner>;
  /**
   * The thread this banner is standing in front of, so a banner can offer the
   * call. Omitted where no thread exists yet.
   */
  thread?: { conversationId: string; contactName: string; canCall: boolean };
}) {
  const { role } = useActiveCompany();
  const isOwner = role === "owner";
  const isAdminUp = role === "owner" || role === "admin";

  const portal = useBillingPortal();
  const updateCompany = useUpdateCompany();
  const company = useCompany();

  const openPortal = () =>
    portal.mutate(undefined, {
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (error) =>
        toast.error(error instanceof ApiError ? error.message : "Couldn't open billing."),
    });

  const raiseCap = () => {
    const current = company.data?.overage_cap_multiplier;
    const multiplier = current === null || current === undefined ? null : Number(current);
    // One more month-quota of headroom per click (SPEC §2 owner one-click raise).
    const next = multiplier === null ? null : Math.floor(multiplier) + 1;
    if (next === null) return; // no cap set — nothing to raise
    updateCompany.mutate(
      { overage_cap_multiplier: next },
      {
        onSuccess: () =>
          toast.success(`Cap raised to ${next}× your included messages.`),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Couldn't raise the cap."),
      },
    );
  };

  // #396: the hint reads as DESTRUCTIVE alongside a real opt-out, not as the
  // amber "you cannot send" family. Sending here is possible and probably
  // unlawful, which is a heavier thing than a blocked composer, and a warning
  // that looks like the routine ones gets read like the routine ones.
  const tone =
    banner.kind === "opted_out" || banner.kind === "opt_out_hint"
      ? "border-destructive/30 bg-destructive/10 text-foreground"
      : "border-warning/40 bg-warning/10 text-foreground";

  let sentence: string;
  let action: React.ReactNode = null;

  switch (banner.kind) {
    // #363: what is true, and what to do — G10's "what happened + what to do,
    // one sentence each". No action button, deliberately: the remedy is a
    // conversation with a person, and a control that only navigates somewhere
    // they also cannot change would be a second dead end.
    case "number_access":
      sentence =
        "You can add internal notes here, but not text this customer from this number. Ask an owner or admin for access.";
      break;
    case "opted_out":
      // Say what can actually be done about it. A STOP is the customer's to
      // undo; a hand-recorded opt-out is the crew's.
      sentence = banner.carrierBlocked
        ? "This customer texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number."
        : "This customer is marked opted out. You can undo that on their contact.";
      break;
    case "subscription":
      if (banner.status === "past_due" || banner.status === "unpaid") {
        sentence = "Update your payment method to send messages.";
        if (isAdminUp) {
          action = (
            <Button size="sm" onClick={openPortal} disabled={portal.isPending}>
              {portal.isPending ? "Opening…" : "Update payment"}
            </Button>
          );
        }
      } else {
        sentence = "Your subscription isn't active, so sending is off.";
        if (isAdminUp) {
          action = (
            <Button size="sm" asChild>
              <a href="/settings/billing">Go to billing</a>
            </Button>
          );
        }
      }
      break;
    case "us_texting_off":
      // No registration is pending here, so promising an approval would be a
      // wait that never ends. Name the switch that is actually off.
      sentence = isAdminUp
        ? "This is a US number, and US texting isn't on for this workspace."
        : "This is a US number, and US texting isn't on for this workspace. An owner can add it.";
      if (isAdminUp) {
        action = (
          <Button size="sm" asChild>
            <a href="/settings/numbers">Add US texting</a>
          </Button>
        );
      } else if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label="Call them instead"
          />
        );
      }
      break;
    case "registration_suspended":
      // #423. Deliberately NOT the pending copy: promising approval to a
      // workspace that WAS approved is a wait that never ends, and it sends
      // them hunting for a form to fill in. Say what happened, say who is
      // acting on it, and say what still works — the same three things the
      // email says, so the two never contradict each other.
      sentence =
        "The carrier paused your US registration, so US texts won't send. We've been told and we're on it — you'll get an email when it's back. Canadian texts and calls still work.";
      // Registration gates TEXTING only, so the call still connects — and for
      // a suspension it is the only thing the reader can actually do now.
      if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label="Call them instead"
          />
        );
      }
      break;
    case "registration_pending":
      sentence =
        "US texting activates once your registration is approved. Usually 3 to 7 business days.";
      // Carrier registration gates TEXTING only: calling this customer works
      // today, on every plan. Without this the banner is a dead end for the
      // whole 3-to-7-day wait, next to a Call button in the header that the
      // reader has no reason to connect to the sentence they just read.
      if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label="Call them instead"
          />
        );
      }
      break;
    case "usage_cap":
      // #178: the cap is the owner's protection, not a quota — name it that way.
      sentence = isOwner
        ? "Sending is paused at the spending cap you set. Nothing bills past it."
        : "Sending is paused at this workspace's spending cap. Ask your account owner to raise it.";
      if (isOwner) {
        action = (
          <Button size="sm" onClick={raiseCap} disabled={updateCompany.isPending}>
            {updateCompany.isPending ? "Raising…" : "Raise cap"}
          </Button>
        );
      }
      break;
    case "opt_out_hint":
      // #396: says what was seen and who decides. It does NOT opt anyone out —
      // only the customer can, and only they can lift it, so a wrong guess
      // would silence a real lead for good.
      sentence =
        "Someone on this thread asked not to be contacted. That request is binding however it is worded, so don't reply unless you are sure it wasn't one. To stop texts for good, they need to text STOP.";
      break;
  }

  return (
    <div
      // A legal obligation, not a status line — announced rather than polled.
      role={banner.kind === "opt_out_hint" ? "alert" : "status"}
      className={cn(
        "flex items-center justify-between gap-3 border-t px-4 py-3",
        tone,
      )}
    >
      <p className="text-sm">{sentence}</p>
      {action}
    </div>
  );
}
