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

  const tone =
    banner.kind === "opted_out"
      ? "border-destructive/30 bg-destructive/10 text-foreground"
      : "border-warning/40 bg-warning/10 text-foreground";

  let sentence: string;
  let action: React.ReactNode = null;

  switch (banner.kind) {
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
  }

  return (
    <div
      role="status"
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
