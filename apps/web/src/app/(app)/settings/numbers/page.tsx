"use client";

import { partitionNumbers } from "@/components/porting/port-ui-state";
import { LeadSourcesCard } from "@/components/settings/lead-sources-card";
import { MyAccessCard } from "@/components/settings/my-access-card";
import { NumberCard } from "@/components/settings/number-card";
import { numberHoldState } from "@/components/settings/number-hold";
import { PortSection } from "@/components/settings/port-section";
import { ProvisionNumberDialog } from "@/components/settings/provision-number-dialog";
import { RegistrationSection } from "@/components/settings/registration-section";
import { LoadError, SettingsPage } from "@/components/settings/section";
import { TextEnableSection } from "@/components/settings/text-enable-section";
import { WebsiteWidgetCard } from "@/components/settings/website-widget-card";
import { splitHostedNumbers } from "@/components/settings/text-enable-state";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEnv } from "@/env";
import { useT } from "@/i18n/provider";
import { useHeldNumbers } from "@/lib/api/billing";
import { useCompany } from "@/lib/api/companies";
import { useNumbers } from "@/lib/api/numbers";
import { usePortRequests } from "@/lib/api/porting";
import { useActiveCompany } from "@/lib/company/provider";
import {
  extraNumberBlockedReason, roleHasCapability,
  billingCurrencyOf,
} from "@loonext/shared";

/** SPEC §2: Pro includes 2 numbers, Starter 1. */
const PLAN_NUMBER_LIMIT = { starter: 1, pro: 2 } as const;

/**
 * #232: where the snippet points. The configured app origin when there is one,
 * and otherwise wherever this page is being served from — so a snippet copied
 * out of a preview or a local run resolves instead of pointing at production.
 */
function widgetOrigin(): string {
  if (publicEnv.NEXT_PUBLIC_APP_ORIGIN) return publicEnv.NEXT_PUBLIC_APP_ORIGIN;
  return typeof window === "undefined" ? "" : window.location.origin;
}

export default function NumbersSettingsPage() {
  const t = useT();
  const appOrigin = widgetOrigin();
  const { role } = useActiveCompany();
  const company = useCompany();
  const numbers = useNumbers();
  // Also read the ports so a ported number is rendered ONCE — through the port
  // stepper (PortSection), never additionally as a "Setting up… under a minute"
  // NumberCard (a flat contradiction of the multi-day transfer window,
  // PORTING.md §2.3/§8.2). Ports load independently: the partition decides on
  // the row's own `source`, which needs no port data, so an empty/loading ports
  // list still separates transfer rows correctly.
  const ports = usePortRequests();
  /**
   * #523: why any suspended number here is suspended.
   *
   * Asked ONLY when there is a suspended row to explain, and only by a reader
   * who can read the route at all (it is behind `billing.manage`, so a member
   * gets a 403). A healthy workspace — which is nearly all of them, nearly all
   * the time — never spends this request, the same discipline `useMissedWhileOff`
   * and `usePauseOffer` follow on the billing screen.
   *
   * `numbers.data` is undefined while the list is still loading, so this starts
   * disabled and enables itself once there is something to ask about.
   */
  const hasSuspended = (numbers.data?.data ?? []).some(
    (n) => n.status === "suspended",
  );
  const held = useHeldNumbers(
    hasSuspended &&
      roleHasCapability(role, "billing.manage") &&
      company.data?.subscription_status === "active",
  );

  const pending = company.isPending || numbers.isPending;
  const error = company.isError || numbers.isError;

  return (
    <SettingsPage
      title={t("appShell.numbersTitle")}
      description={t("appShell.numbersDescription")}
    >
      {pending ? (
        <div className="space-y-4" aria-label={t("appShell.numbersLoading")}>
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : error ? (
        <LoadError
          onRetry={() => {
            void company.refetch();
            void numbers.refetch();
          }}
        />
      ) : (
        (() => {
          // A hosted (keep-your-number text-enabled) row is rendered ONCE,
          // through the TextEnableSection order card — never as a NumberCard,
          // whose "under a minute" provisioning copy would flatly contradict
          // the multi-day carrier review. Same de-duplication discipline as
          // the ported rows partitioned out just below.
          const { hosted, rest } = splitHostedNumbers(numbers.data.data);
          const { provisioned } = partitionNumbers(
            rest,
            ports.data?.data ?? [],
          );
          // A transfer or text-enablement in flight IS a number — the "no
          // number yet" empty state only applies when there is neither a
          // provisioned number, a port, nor a hosted row.
          const hasAnyNumber =
            provisioned.length > 0 ||
            hosted.length > 0 ||
            (ports.data?.data.length ?? 0) > 0;
          // A number slot counts ALL non-released numbers (a ported row holds
          // the same one slot as a provisioned one), so the affordance never
          // appears once a port already fills the seat.
          const usedSlots = numbers.data.data.filter(
            (n) => n.status !== "released",
          ).length;
          const limit = company.data.plan
            ? PLAN_NUMBER_LIMIT[company.data.plan]
            : 0;
          // #105 (#80): past the included count, the next number is a PAID
          // extra — $5/mo on Starter (hard max 2 total), $4/mo on Pro
          // (unlimited). The message allowance stays shared across all numbers.
          // #464: the eligibility rule is the SERVER'S, imported rather than
          // restated — this page used to carry its own copy that refused every
          // Canadian workspace, which is the bug that issue reported.
          const paidExtra = usedSlots >= limit && limit > 0;
          const extraBlockedReason = company.data.plan
            ? extraNumberBlockedReason({
                plan: company.data.plan,
                currentCount: usedSlots,
                country: company.data.country,
                usTextingEnabled: company.data.us_texting_enabled,
                billingCurrency: billingCurrencyOf(
                  company.data.billing_currency,
                ),
              }, t)
            : t("appShell.numbersNoPlanYet");
          const canBuyExtra = paidExtra && extraBlockedReason === null;
          // #74: a plan-included number can be (re)provisioned in-app whenever a
          // slot is open — NOT just Pro's second number. This is what lets a
          // Starter who released their only number get a replacement (their plan
          // still includes one), instead of being stranded. Gated on an active
          // subscription (the server refuses otherwise) and owner/admin.
          const canProvision =
            (role === "owner" || role === "admin") &&
            company.data.subscription_status === "active" &&
            (usedSlots < limit || canBuyExtra);

          return (
            <div className="space-y-6">
              {/* #301: ABOVE the numbers, because it is the vocabulary the
                  per-number picker below chooses from — a list somebody meets
                  after being asked to pick from it is a list they have to go
                  and find. *Applying: Prioritize Intent.* */}
              <LeadSourcesCard canEdit={role === "owner" || role === "admin"} />
              {/* #232: on the NUMBERS page rather than a page of its own. The
                  widget's whole job is to turn a website visitor into a
                  conversation on one of these numbers, and a lone settings page
                  for one button is a page nobody finds. Gated on the same
                  capability the API gates the key with — a card that renders a
                  403 is a worse answer than a card that is not there.
                  *Applying: the Safety principle — put a thing where somebody
                  would look for it.* */}
              {roleHasCapability(role, "settings.manage") ? (
                <WebsiteWidgetCard appOrigin={appOrigin} />
              ) : null}
              {hasAnyNumber ? (
                provisioned.map((number) => (
                  <NumberCard
                    key={number.id}
                    number={number}
                    hold={numberHoldState({
                      status: number.status,
                      numberId: number.id,
                      subscriptionActive:
                        company.data.subscription_status === "active",
                      held: held.data,
                    })}
                    // #523: half of the release rule (`mayReleaseNumber`) — a
                    // held number may be given up, but not while the problem is
                    // the payment rather than the plan.
                    subscriptionActive={
                      company.data.subscription_status === "active"
                    }
                  />
                ))
              ) : canProvision ? null : (
                // No number AND no open slot to fill in-app (e.g. pre-checkout):
                // the first number is created automatically once the plan starts.
                <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">
                  {t("appShell.numbersNoneYet")}
                </p>
              )}

              {/* Below the numbers they DO have, because it explains the
                  shape of the list above rather than competing with it.
                  *Applying: Zen of Clarity — the primary view stays about the
                  numbers this person can actually use.* */}
              {/* #286: what a member CANNOT reach, and why.
                  It replaces the bare count that used to sit here — "ask an
                  owner if you need them" was the cost #286 is about, and a
                  member who cannot tell a deliberate restriction from a broken
                  app resolves it by interrupting somebody. Renders nothing for
                  anyone who reaches everything, which is every owner and admin
                  and most members. */}
              <MyAccessCard />

              {canProvision && (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    {paidExtra
                      ? // #105: an honest price BEFORE the picker opens, plus
                        // the shared-quota truth (an extra never adds messages).
                        t("appShell.numbersExtraPaid", {
                          price:
                            company.data.plan === "starter" ? "$5" : "$4",
                        })
                      : usedSlots === 0
                        ? // A released/first included number: getting one back is
                          // part of the plan they already pay for.
                          t("appShell.numbersFirstIncluded")
                        : t("appShell.numbersProSecond")}
                  </p>
                  <ProvisionNumberDialog country={company.data.country} />
                </div>
              )}

              {/* #523: the numbers and the billing answer go DOWN to the port
                  section, because a transferred-in line is drawn only by its
                  stepper — so the stepper is the only place its hold can be
                  said. Both are already loaded and already gated here; asking
                  again inside the section would be a second copy of the rule
                  about who may ask. */}
              <PortSection
                company={company.data}
                numbers={numbers.data.data}
                held={held.data}
              />

              <TextEnableSection company={company.data} />

              <RegistrationSection company={company.data} />
            </div>
          );
        })()
      )}
    </SettingsPage>
  );
}
