"use client";

import {
  supportMailto,
  supportSituation,
  supportSubjectFor,
} from "@loonext/shared";
import { toast } from "sonner";

import { CallButton } from "@/components/calls/call-button";
import { Button } from "@/components/ui/button";
import { useT, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useBillingPortal } from "@/lib/api/billing";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { recentClientErrors } from "@/lib/observability/recent-errors";
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
  const t = useT();
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
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("thread.billingOpenFailed"),
        ),
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
          toast.success(t("thread.capRaised", { count: next })),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("thread.capRaiseFailed"),
          ),
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
    case "read_only":
      sentence = t("thread.bannerReadOnly");
      break;
    case "number_access":
      sentence = t("thread.bannerNumberAccess");
      break;
    case "opted_out":
      // Say what can actually be done about it. A STOP is the customer's to
      // undo; a hand-recorded opt-out is the crew's.
      sentence = banner.carrierBlocked
        ? t("thread.bannerOptedOutCarrier")
        : t("thread.bannerOptedOut");
      break;
    case "subscription":
      if (banner.status === "past_due" || banner.status === "unpaid") {
        sentence = t("thread.bannerPastDue");
        if (isAdminUp) {
          action = (
            <Button size="sm" onClick={openPortal} disabled={portal.isPending}>
              {portal.isPending
                ? t("thread.opening")
                : t("thread.updatePayment")}
            </Button>
          );
        }
      } else {
        sentence = t("thread.bannerSubscriptionInactive");
        if (isAdminUp) {
          action = (
            <Button size="sm" asChild>
              <a href="/settings/billing">{t("thread.goToBilling")}</a>
            </Button>
          );
        }
      }
      break;
    case "us_texting_off":
      // No registration is pending here, so promising an approval would be a
      // wait that never ends. Name the switch that is actually off.
      sentence = isAdminUp
        ? t("thread.bannerUsTextingOffAdmin")
        : t("thread.bannerUsTextingOffMember");
      if (isAdminUp) {
        action = (
          <Button size="sm" asChild>
            <a href="/settings/numbers">{t("thread.addUsTexting")}</a>
          </Button>
        );
      } else if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label={t("thread.callThemInstead")}
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
      sentence = t("thread.bannerRegistrationSuspended");
      // Registration gates TEXTING only, so the call still connects — and for
      // a suspension it is the only thing the reader can actually do now.
      if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label={t("thread.callThemInstead")}
          />
        );
      }
      break;
    case "registration_pending":
      sentence = t("thread.bannerRegistrationPending");
      // Carrier registration gates TEXTING only: calling this customer works
      // today, on every plan. Without this the banner is a dead end for the
      // whole 3-to-7-day wait, next to a Call button in the header that the
      // reader has no reason to connect to the sentence they just read.
      if (thread?.canCall) {
        action = (
          <CallButton
            conversationId={thread.conversationId}
            contactName={thread.contactName}
            label={t("thread.callThemInstead")}
          />
        );
      }
      break;
    case "usage_cap":
      // #178: the cap is the owner's protection, not a quota — name it that way.
      sentence = isOwner
        ? t("thread.bannerUsageCapOwner")
        : t("thread.bannerUsageCapMember");
      if (isOwner) {
        action = (
          <Button size="sm" onClick={raiseCap} disabled={updateCompany.isPending}>
            {updateCompany.isPending
              ? t("thread.raising")
              : t("thread.raiseCap")}
          </Button>
        );
      }
      break;
    case "opt_out_hint":
      // #396: says what was seen and who decides. It does NOT opt anyone out —
      // only the customer can, and only they can lift it, so a wrong guess
      // would silence a real lead for good.
      sentence = t("thread.bannerOptOutHint");
      break;
  }

  return (
    <div
      // A legal obligation, not a status line — announced rather than polled.
      role={banner.kind === "opt_out_hint" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t px-4 py-3",
        tone,
      )}
    >
      <p className="text-sm">{sentence}</p>
      <div className="flex items-center gap-3">
        {action}
        <ReportThis kind={banner.kind} company={company.data ?? null} t={t} />
      </div>
    </div>
  );
}

/**
 * #253 — one tap from the banner that just said something failed, to telling us.
 *
 * # Why every banner gets this, not only the ones we cannot fix
 *
 * The tempting rule is "no report link where the reader already has a remedy" —
 * no point mailing support about a cap an owner can raise in one click. But
 * deciding which failures deserve a voice is precisely the asymmetry #253 is
 * about. A report we did not need costs one read. A report we never got costs a
 * customer, and we record it as churn rather than as the bug it was.
 *
 * # It never competes with the remedy
 *
 * Rendered as a quiet text link after the action button, never as a second
 * button. Where "Raise cap" exists, raising the cap is the right thing to do and
 * the layout should say so — this is the door for the person that did not work
 * for.
 *
 * *Applying: Zen of Clarity — secondary actions stay visually secondary. G10 —
 * the subject line names the exact state, so the reader is never asked to
 * describe a screen they did not write.*
 */
function ReportThis({
  kind,
  company,
  t,
}: {
  kind: string;
  company: { id: string; name: string; plan: string | null } | null;
  t: Translate;
}) {
  // A situation we have no sentence for would send a support email that says
  // nothing the customer did not already have to type — worse than no link.
  if (company === null || supportSituation(kind) === null) return null;

  return (
    <a
      className="shrink-0 text-xs underline underline-offset-2 opacity-70 transition-opacity hover:opacity-100"
      href={supportMailto({
        companyId: company.id,
        companyName: company.name,
        plan: company.plan,
        platform: "web",
        subject: supportSubjectFor(kind),
        situation: supportSituation(kind),
        // Read at click time, not at render: the useful errors are the ones
        // that happened while the person was staring at this banner.
        recentErrors: recentClientErrors(),
      })}
    >
      {t("thread.reportThis")}
    </a>
  );
}
