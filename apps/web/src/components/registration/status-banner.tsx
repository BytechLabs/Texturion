"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useCompany } from "@/lib/api/companies";
import { useRegistration } from "@/lib/api/registration";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

import { REGISTRATION_COPY } from "./copy";
import {
  deriveRegistrationUiState,
  type RegistrationUiState,
} from "./registration-ui-state";

/**
 * WorkspaceStatusBanner (cross-track contract; DESIGN.md G7, SPEC §4.4): the
 * slim ambient amber strip mounted app-wide (in the shell, above every page).
 * Self-fetching (the registration + company hooks — the realtime provider
 * invalidates both on `registration.updated` / `number.updated`), links to the
 * fix surface, renders null when there's nothing to say, and fires the green
 * "You're live" toast on the observed approval transition (G7). It covers the
 * SPEC §4.4 provisioning/registration states AND the workspace-level billing
 * states (canceled / payment issue / unfinished-setup-for-members) so a
 * not-ready workspace is obvious on every page, not just the inbox.
 */
export function WorkspaceStatusBanner() {
  const company = useCompany();
  const registration = useRegistration();
  const { role } = useActiveCompany();

  const state: RegistrationUiState | null = company.data
    ? deriveRegistrationUiState({
        country: company.data.country,
        usTextingEnabled: company.data.us_texting_enabled,
        subscriptionStatus: company.data.subscription_status,
        role,
        numbers: company.data.numbers,
        brand: company.data.registration.brand,
        campaign: company.data.registration.campaign,
      })
    : null;

  // G7: approval swaps the banner for the green toast — fired only on an
  // observed transition (a session that loads already-approved never toasts;
  // the server-side email covered it).
  const previousKind = useRef<RegistrationUiState["kind"] | null>(null);
  const kind = state?.kind ?? null;
  useEffect(() => {
    if (kind === null) return;
    if (
      kind === "approved" &&
      previousKind.current !== null &&
      previousKind.current !== "approved" &&
      previousKind.current !== "none"
    ) {
      toast.success(REGISTRATION_COPY.approvedToast);
    }
    previousKind.current = kind;
  }, [kind]);

  // Loading and errors stay silent — this is an ambient status strip; the
  // screens it links to carry the full states.
  if (!state || state.kind === "none" || state.kind === "approved") {
    return null;
  }

  // OTP target phone: wizard data rides GET /v1/registration for owner/admin
  // (the only roles that can enter the code); members get a neutral label.
  const brandData = registration.data?.brand?.data;
  const otpPhone =
    typeof brandData?.mobilePhone === "string"
      ? formatPhone(brandData.mobilePhone)
      : "your mobile";

  const message =
    state.kind === "setup_unfinished_member"
      ? REGISTRATION_COPY.setupUnfinishedMember
      : state.kind === "subscription_canceled"
        ? REGISTRATION_COPY.subscriptionCanceled
        : state.kind === "payment_issue"
          ? REGISTRATION_COPY.paymentIssue
          : state.kind === "number_provisioning"
            ? REGISTRATION_COPY.numberProvisioning
            : state.kind === "number_delayed"
              ? REGISTRATION_COPY.numberDelayed
              : state.kind === "number_action_needed"
                ? REGISTRATION_COPY.numberActionNeeded(state.areaCode)
                : state.kind === "number_hosted_review"
                  ? REGISTRATION_COPY.hostedReview
                : state.kind === "otp_pending"
                  ? REGISTRATION_COPY.otpPending(otpPhone)
                  : state.kind === "rejected"
                    ? REGISTRATION_COPY.rejected(
                        state.reason ?? "the carrier flagged a detail",
                      )
                    : REGISTRATION_COPY.registrationPending;

  // Members of an unpaid workspace can't act — the strip is informational only.
  const action: { href: string; label: string } | null =
    state.kind === "setup_unfinished_member"
      ? null
      : state.kind === "subscription_canceled"
        ? { href: "/settings/billing", label: "Billing" }
        : state.kind === "payment_issue"
          ? { href: "/settings/billing", label: "Update billing" }
          : state.kind === "otp_pending"
            ? { href: "/onboarding/setting-up", label: "Enter code" }
            : state.kind === "rejected"
              ? { href: "/settings/numbers", label: "Fix and resubmit" }
              : state.kind === "number_action_needed"
                ? { href: "/settings/numbers", label: "Choose a number" }
                : { href: "/settings/numbers", label: "Details" };

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2"
    >
      <TriangleAlert
        className="size-4 shrink-0 text-warning"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground/80">
        {message}
      </p>
      {action && (
        <Link
          href={action.href}
          className="shrink-0 text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
