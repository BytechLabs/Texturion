"use client";

import Link from "next/link";

import { REGISTRATION_COPY } from "@/components/registration/copy";
import { hostedReviewOnly } from "@/components/registration/registration-ui-state";
import { Button } from "@/components/ui/button";
import { NumberReveal } from "@/components/ui/number-reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeCompany } from "@/lib/api/me-company";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

/**
 * G4 bespoke empty states — never generic.
 */

/**
 * Filtered view with nothing in it — delight moment #2 (§3.1): quiet and
 * kind, one line, centered, generous air, no illustration, no emoji. The
 * reassurance IS the design.
 */
export function FilteredEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <p className="text-[15px] text-muted-foreground">
        Nothing waiting on you.
      </p>
    </div>
  );
}

/**
 * Brand new company, no messages ever — the activation moment (G4): the
 * business number huge (32px, tabular) from GET /v1/me with a copy button.
 * While the number is still provisioning, the honest §4.4 state shows
 * instead; realtime `number.updated` swaps it in without a refresh.
 *
 * Honest gating first (G1.5 — no promise a number is coming when nothing is
 * provisioning): a company that never completed checkout (`incomplete` /
 * `incomplete_expired`) gets the way back into the resumable wizard (G7),
 * and a canceled company is pointed at billing — never the provisioning line.
 */
export function ActivationEmptyState() {
  const me = useMeCompany();
  const { role } = useActiveCompany();

  const numbers = me.data?.company?.numbers ?? [];
  const activeNumber = numbers.find(
    (n) => n.status === "active" && n.number_e164 !== null,
  );

  if (me.isPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  if (!activeNumber?.number_e164) {
    const status = me.data?.company?.subscription_status;
    // Owners/admins act; members can only relay (checkout/billing are O/A).
    const canAct = role === "owner" || role === "admin";

    if (status === "incomplete" || status === "incomplete_expired") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">
            {canAct
              ? "One step left: finish checkout to get your business number and start texting."
              : "Checkout isn't finished yet. Ask your account owner to complete it, then your business number appears here."}
          </p>
          {canAct && (
            <Button asChild size="sm">
              {/* /onboarding resumes at the exact step left off (G7). */}
              <Link href="/onboarding">Finish setting up</Link>
            </Button>
          )}
        </div>
      );
    }

    if (status === "canceled") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">
            {canAct
              ? "Your subscription is canceled, so there's no active number. Restart it from billing to keep texting."
              : "Your subscription is canceled, so there's no active number. Ask your account owner to restart it."}
          </p>
          {canAct && (
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/billing">Go to billing</Link>
            </Button>
          )}
        </div>
      );
    }

    // Voice wave: the only live number is a hosted text-enablement in
    // carrier review (days) — the honest line, never "under a minute".
    if (hostedReviewOnly(numbers)) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">
            {REGISTRATION_COPY.hostedReview}
          </p>
          <Link
            href="/settings/numbers"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            See progress in Settings
          </Link>
        </div>
      );
    }

    // Paid and genuinely provisioning — the §4.4 exact string.
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">
          {REGISTRATION_COPY.numberProvisioning}
        </p>
      </div>
    );
  }

  const display = formatPhone(activeNumber.number_e164);

  // Delight moment #1 — the activation reveal (§3.1): the app's most confident,
  // exclamation-free peak of magic. The shared <NumberReveal> renders it in the
  // §2.2 emotional-number scale (36px tabular Inter, tight tracking) with the
  // one budgeted fade+rise, a copy button, and the warm caption centered with
  // breathing room around it.
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <NumberReveal
        value={display}
        copyable
        copyLabel="Copy your business number"
        // Center the number+copy row; constrain the caption to a calm measure.
        className="flex flex-col items-center [&>div:first-child]:justify-center [&>p]:max-w-[280px] [&>p]:text-[15px] [&>p]:leading-relaxed"
        caption="This is your business number. Text it from your phone right now, and your message will appear here."
      />
    </div>
  );
}

/** Pulsing skeleton rows — first load only, never on realtime updates (G4). */
export function ListSkeleton() {
  return (
    <div
      aria-hidden
      className="flex-1 space-y-1 overflow-hidden px-2.5 pb-3 pt-1.5"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="flex h-24 items-start gap-[11px] rounded-app-card border border-transparent p-[11px]"
        >
          <Skeleton className="size-[38px] shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
