"use client";

import { numberForPort } from "@/components/porting/port-ui-state";
import { holdForPort } from "@/components/settings/number-hold";
import { PortCard } from "@/components/settings/port-card";
import { StartPortDialog } from "@/components/settings/start-port-dialog";
import { LoadError, SettingsCard } from "@/components/settings/section";
import { usePortEvents } from "@/components/settings/use-port-events";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import type { HeldNumbersView } from "@/lib/api/billing";
import { usePortRequests } from "@/lib/api/porting";
import type { CompanyView, PhoneNumberSummary } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * Settings → Numbers port section (PORTING.md §8.2): lists the company's port
 * requests as calm 4-step trackers, live via the `port.updated` broadcast, and
 * offers an owner/admin the post-signup "bring a number" flow. Renders nothing
 * (except the start affordance) when there are no ports, so the numbers page
 * stays clean for the common new-number case.
 */
export function PortSection({
  company,
  numbers,
  held,
}: {
  company: CompanyView;
  /**
   * #523: the company's `phone_numbers` rows, so a transfer can find out
   * whether the line it delivered is still working.
   *
   * Passed down rather than re-fetched here. The page has already loaded the
   * list and already decided — once, for the whole screen — whether the billing
   * route may even be asked; a second opinion on either would be a second thing
   * to keep in step. Defaulted so a caller that does not have the list yet gets
   * today's behaviour instead of a crash.
   */
  numbers?: readonly PhoneNumberSummary[];
  /** The billing answer, when this reader could ask for it. */
  held?: HeldNumbersView;
}) {
  const t = useT();
  const { companyId, role } = useActiveCompany();
  const ports = usePortRequests();
  usePortEvents(companyId);

  const canStart = role === "owner" || role === "admin";
  const active = company.subscription_status === "active";

  if (ports.isPending) {
    return (
      <SettingsCard title={t("settingsMore.portSectionTitle")}>
        <Skeleton className="h-32 w-full" />
      </SettingsCard>
    );
  }
  if (ports.isError) {
    return (
      <SettingsCard title={t("settingsMore.portSectionTitle")}>
        <LoadError onRetry={() => ports.refetch()} />
      </SettingsCard>
    );
  }

  const rows = ports.data.data;

  // No transfers yet: only surface the "bring a number" affordance to O/A on an
  // active subscription (a port is a post-payment action, D16).
  if (rows.length === 0) {
    if (!canStart || !active) return null;
    return (
      <SettingsCard
        title={t("settingsMore.portBringNumberTitle")}
        description={t("settingsMore.portBringNumberDescription")}
      >
        <StartPortDialog country={company.country} />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={t("settingsMore.portSectionTitle")}
      description={t("settingsMore.portSectionDescription")}
    >
      <div className="space-y-5">
        {rows.map((port) => (
          <PortCard
            key={port.id}
            port={port}
            country={company.country}
            // #523: the `phone_numbers` row this transfer delivered, or null
            // while it has not. It is what lets the card offer to give the line
            // up — a ported row is de-duplicated out of the number cards, so
            // this card is the only place that control can live, and without it
            // the owner of a held ported line had no way to release it in a
            // browser at all. Also what tells the card there is no transfer left
            // to cancel.
            number={numberForPort(port, numbers ?? [])}
            // #523: null on every ordinary transfer — `numberForPort` finds no
            // row until the number has actually arrived, and `numberHoldState`
            // answers null for anything that is not `suspended`.
            hold={holdForPort(port, numbers ?? [], company, held)}
            subscriptionActive={active}
          />
        ))}
        {canStart && active ? (
          <div className="border-t border-border-subtle pt-4">
            <StartPortDialog country={company.country} />
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
