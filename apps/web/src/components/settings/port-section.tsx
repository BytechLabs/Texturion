"use client";

import { PortCard } from "@/components/settings/port-card";
import { StartPortDialog } from "@/components/settings/start-port-dialog";
import { LoadError, SettingsCard } from "@/components/settings/section";
import { usePortEvents } from "@/components/settings/use-port-events";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortRequests } from "@/lib/api/porting";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * Settings → Numbers port section (PORTING.md §8.2): lists the company's port
 * requests as calm 4-step trackers, live via the `port.updated` broadcast, and
 * offers an owner/admin the post-signup "bring a number" flow. Renders nothing
 * (except the start affordance) when there are no ports, so the numbers page
 * stays clean for the common new-number case.
 */
export function PortSection({ company }: { company: CompanyView }) {
  const { companyId, role } = useActiveCompany();
  const ports = usePortRequests();
  usePortEvents(companyId);

  const canStart = role === "owner" || role === "admin";
  const active = company.subscription_status === "active";

  if (ports.isPending) {
    return (
      <SettingsCard title="Number transfers">
        <Skeleton className="h-32 w-full" />
      </SettingsCard>
    );
  }
  if (ports.isError) {
    return (
      <SettingsCard title="Number transfers">
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
        title="Bring your existing number"
        description="Transfer the number your customers already know to Loonext. It's free, and it keeps working until the switch completes."
      >
        <StartPortDialog country={company.country} />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Number transfers"
      description="Bringing your existing number over to Loonext."
    >
      <div className="space-y-5">
        {rows.map((port) => (
          <PortCard key={port.id} port={port} country={company.country} />
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
