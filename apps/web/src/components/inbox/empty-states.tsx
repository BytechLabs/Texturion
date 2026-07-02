"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { REGISTRATION_COPY } from "@/components/registration/copy";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeCompany } from "@/lib/api/me-company";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

/**
 * G4 bespoke empty states — never generic.
 */

/** Filtered view with nothing in it: quiet one-liner. */
export function FilteredEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">Nothing waiting on you. 🎉</p>
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
  const [copied, setCopied] = useState(false);

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
              : "Checkout isn't finished yet — ask your account owner to complete it, then your business number appears here."}
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions): the number stays selectable.
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex items-center gap-2">
        <p className="select-all text-[32px] font-semibold leading-tight tabular-nums text-foreground">
          {display}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={copy}
          aria-label={copied ? "Number copied" : "Copy number"}
        >
          {copied ? (
            <Check className="size-4 text-success" strokeWidth={1.75} />
          ) : (
            <Copy className="size-4" strokeWidth={1.75} />
          )}
        </Button>
      </div>
      <p className="max-w-[260px] text-sm text-muted-foreground">
        This is your business number. Text it from your phone right now — your
        message will appear here.
      </p>
    </div>
  );
}

/** Pulsing skeleton rows — first load only, never on realtime updates (G4). */
export function ListSkeleton() {
  return (
    <div aria-hidden className="flex-1 overflow-hidden">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex h-[68px] items-center gap-3 border-b border-border/60 px-4"
        >
          <Skeleton className="size-2 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
