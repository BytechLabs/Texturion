"use client";

import { useCanOpenSettings } from "@/components/settings/settings-link-guard";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useRegistration } from "@/lib/api/registration";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

import { useNow } from "@/lib/use-now";

import { provisioningWaitCopy, REGISTRATION_COPY } from "./copy";
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
  // #515: before any early return — this component bails out for the happy
  // cases below, and a hook called after that runs in a different order on
  // different renders.
  const t = useT();
  const canOpen = useCanOpenSettings();
  const company = useCompany();
  const registration = useRegistration();
  const { role } = useActiveCompany();
  const now = useNow(); // ticks the progressive provisioning copy

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
      toast.success(t("shell.regApprovedToast"));
    }
    previousKind.current = kind;
    // `t` re-runs this on a language change and cannot double-toast: the guard
    // above needs the PREVIOUS kind to differ, and the line below has just set
    // it to this one.
  }, [kind, t]);

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
      : t("shell.regBannerYourMobile");

  const message =
    state.kind === "setup_unfinished_member"
      ? t("shell.regSetupUnfinishedMember")
      : state.kind === "subscription_canceled"
        ? t("shell.regSubscriptionCanceled")
        : state.kind === "payment_issue"
          ? t("shell.regPaymentIssue")
          : state.kind === "number_provisioning"
            ? provisioningWaitCopy(state.createdAt, now, t)
            : state.kind === "number_delayed"
              ? t("shell.regNumberDelayed")
              : state.kind === "number_action_needed"
                ? REGISTRATION_COPY.numberActionNeeded(state.areaCode, t)
                : state.kind === "number_hosted_review"
                  ? t("shell.regHostedReview")
                : state.kind === "otp_pending"
                  ? REGISTRATION_COPY.otpPending(otpPhone, t)
                  : state.kind === "rejected"
                    ? REGISTRATION_COPY.rejected(
                        state.reason ?? t("shell.regBannerReasonUnknown"),
                        t,
                      )
                    : t("shell.regPending");

  // Members of an unpaid workspace can't act — the strip is informational only.
  //
  // #515: and neither can anybody the destination is closed to. This banner is
  // mounted app-wide for every role, so an unfiltered action offers a member a
  // Billing button that now refuses them. The strip still SAYS what is wrong —
  // that part is everybody's business — it just stops handing out a door.
  const billing = "/settings/billing";
  const numbers = "/settings/numbers";
  const rawAction: { href: string; label: string } | null =
    state.kind === "setup_unfinished_member"
      ? null
      : state.kind === "subscription_canceled"
        ? { href: billing, label: t("shell.navBilling") }
        : state.kind === "payment_issue"
          ? { href: billing, label: t("shell.regBannerUpdateBilling") }
          : state.kind === "otp_pending"
            ? {
                href: "/onboarding/setting-up",
                label: t("shell.regBannerEnterCode"),
              }
            : state.kind === "rejected"
              ? { href: numbers, label: t("shell.regBannerFixResubmit") }
              : state.kind === "number_action_needed"
                ? { href: numbers, label: t("shell.regBannerChooseNumber") }
                : { href: numbers, label: t("shell.regBannerDetails") };

  // Both destinations are Settings sections with a capability behind them.
  // Anything outside Settings (the onboarding code entry) is everybody's.
  const action =
    rawAction === null
      ? null
      : rawAction.href.startsWith("/settings/billing") && !canOpen("billing")
        ? null
        : rawAction.href.startsWith("/settings/numbers") && !canOpen("numbers")
          ? null
          : rawAction;

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
      <p className="min-w-0 flex-1 line-clamp-2 text-[13px] leading-snug text-foreground/80">
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
