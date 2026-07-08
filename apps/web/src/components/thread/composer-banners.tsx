"use client";

import { toast } from "sonner";

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
export function ComposerBannerCard({ banner }: { banner: NonNullable<ComposerBanner> }) {
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
      sentence = "This customer opted out of texting. Sends are blocked.";
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
      break;
    case "usage_cap":
      sentence = isOwner
        ? "You've reached your monthly usage cap."
        : "You've reached your monthly usage cap. Ask your account owner to raise it.";
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
