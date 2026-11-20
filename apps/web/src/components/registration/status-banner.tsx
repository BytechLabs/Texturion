"use client";

import { useCanOpenSettings } from "@/components/settings/settings-link-guard";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useRegistration } from "@/lib/api/registration";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

import { useNow } from "@/lib/use-now";

import { provisioningWaitCopy, REGISTRATION_COPY } from "./copy";
import { deriveRegistrationUiState } from './registration-ui-state';
import type { RegistrationUiState } from './registration-ui-state';

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
  const { role } = useActiveCompany();
  const now = useNow(); // ticks the progressive provisioning copy
  const completionStep = company.data?.registration.completion_step;

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
  // Only the code prompt reads the wizard data, for the phone it names.
  const registration = useRegistration(state?.kind === "otp_pending");

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
  }, [kind, previousKind, t]);

  // Loading and errors stay silent — this is an ambient status strip; the
  // screens it links to carry the full states.
  if (!state || state.kind === "none" || state.kind === "approved") {
    return null;
  }

  // OTP target phone: wizard data rides GET /v1/registration for owner/admin
  // (the only roles that can enter the code); members get a neutral label.
  const brandData = registration.data?.brand?.data;
  const otpPhone = typeof brandData?.mobilePhone === "string" ? brandData.mobilePhone : null;

  let message;
  if (completionStep) {
    message = t(completionStep === "business" ? "shell.regBusinessDetailsNeeded" : "shell.regTextingDetailsNeeded");
  } else if (state.kind === "setup_unfinished_member") {
    message = t("shell.regSetupUnfinishedMember");
  } else if (state.kind === "subscription_canceled") {
    message = t("shell.regSubscriptionCanceled");
  } else if (state.kind === "payment_issue") {
    message = t("shell.regPaymentIssue");
  } else if (state.kind === "number_provisioning") {
    message = provisioningWaitCopy(state.createdAt, now, t);
  } else if (state.kind === "number_delayed") {
    message = t("shell.regNumberDelayed");
  } else if (state.kind === "number_action_needed") {
    message = REGISTRATION_COPY.numberActionNeeded(state.areaCode, t);
  } else if (state.kind === "number_hosted_review") {
    message = t("shell.regHostedReview");
  } else if (state.kind === "otp_pending") {
    message = REGISTRATION_COPY.otpPending(otpPhone ? formatPhone(otpPhone) : t("shell.regBannerYourMobile"), t);
  } else if (state.kind === "rejected") {
    message = REGISTRATION_COPY.rejected(
      state.reason ?? t("shell.regBannerReasonUnknown"),
      t,
    );
  } else {
    message = t("shell.regPending");
  }

  // Members of an unpaid workspace can't act — the strip is informational only.
  //
  // #515: and neither can anybody the destination is closed to. This banner is
  // mounted app-wide for every role, so an unfiltered action offers a member a
  // Billing button that now refuses them. The strip still SAYS what is wrong —
  // that part is everybody's business — it just stops handing out a door.
  const billing = "/settings/billing";
  const numbers = "/settings/numbers";
  let rawAction: { href: string; label: string } | null;
  if (completionStep) {
    rawAction = canOpen("numbers")
      ? { href: `/onboarding/${completionStep}`, label: t("shell.regFinishRegistration") }
      : null;
  } else if (state.kind === "setup_unfinished_member") {
    rawAction = null;
  } else if (state.kind === "subscription_canceled") {
    rawAction = { href: billing, label: t("shell.navBilling") };
  } else if (state.kind === "payment_issue") {
    rawAction = { href: billing, label: t("shell.regBannerUpdateBilling") };
  } else if (state.kind === "otp_pending") {
    rawAction = {
        href: "/onboarding/setting-up",
        label: t("shell.regBannerEnterCode"),
      };
  } else if (state.kind === "rejected") {
    rawAction = { href: numbers, label: t("shell.regBannerFixResubmit") };
  } else if (state.kind === "number_action_needed") {
    rawAction = { href: numbers, label: t("shell.regBannerChooseNumber") };
  } else {
    rawAction = { href: numbers, label: t("shell.regBannerDetails") };
  }

  // Both destinations are Settings sections with a capability behind them.
  // Anything outside Settings (the onboarding code entry) is everybody's.
  let action;
  if (rawAction === null) {
    action = null;
  } else if (rawAction.href.startsWith("/settings/billing") && !canOpen("billing")) {
    action = null;
  } else if (rawAction.href.startsWith("/settings/numbers") && !canOpen("numbers")) {
    action = null;
  } else {
    action = rawAction;
  }

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
      {state.kind === "otp_pending" && otpPhone && <CopyablePhoneNumber number={otpPhone} iconOnly />}
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
