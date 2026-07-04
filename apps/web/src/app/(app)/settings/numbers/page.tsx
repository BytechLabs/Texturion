"use client";

import { partitionNumbers } from "@/components/porting/port-ui-state";
import { NumberCard } from "@/components/settings/number-card";
import { PortSection } from "@/components/settings/port-section";
import { ProvisionNumberDialog } from "@/components/settings/provision-number-dialog";
import { RegistrationSection } from "@/components/settings/registration-section";
import { LoadError, SettingsPage } from "@/components/settings/section";
import { TextEnableSection } from "@/components/settings/text-enable-section";
import { splitHostedNumbers } from "@/components/settings/text-enable-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useNumbers } from "@/lib/api/numbers";
import { usePortRequests } from "@/lib/api/porting";
import { useActiveCompany } from "@/lib/company/provider";

/** SPEC §2: Pro includes 2 numbers, Starter 1. */
const PLAN_NUMBER_LIMIT = { starter: 1, pro: 2 } as const;

export default function NumbersSettingsPage() {
  const { role } = useActiveCompany();
  const company = useCompany();
  const numbers = useNumbers();
  // Also read the ports so a ported number is rendered ONCE — through the port
  // stepper (PortSection), never additionally as a "Setting up… under a minute"
  // NumberCard (a flat contradiction of the multi-day transfer window,
  // PORTING.md §2.3/§8.2). Ports load independently: the partition's primary
  // discriminator (no requested_area_code) needs no port data, so an empty/
  // loading ports list still separates transfer rows correctly.
  const ports = usePortRequests();

  const pending = company.isPending || numbers.isPending;
  const error = company.isError || numbers.isError;

  return (
    <SettingsPage
      title="Numbers"
      description="The numbers your customers text, and your carrier registration."
    >
      {pending ? (
        <div className="space-y-4" aria-label="Loading numbers">
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
          // The Pro second-number slot counts ALL non-released numbers
          // (a ported row holds the same one slot as a provisioned one), so the
          // affordance never appears once a port already fills the seat.
          const usedSlots = numbers.data.data.filter(
            (n) => n.status !== "released",
          ).length;

          return (
            <div className="space-y-6">
              {!hasAnyNumber ? (
                <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">
                  No number yet — it&apos;s created automatically when your
                  subscription starts.
                </p>
              ) : (
                provisioned.map((number) => (
                  <NumberCard key={number.id} number={number} />
                ))
              )}

              {(role === "owner" || role === "admin") &&
                company.data.plan === "pro" &&
                usedSlots < PLAN_NUMBER_LIMIT.pro && (
                  <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      Pro includes a second number — handy for a second crew or
                      service area.
                    </p>
                    <ProvisionNumberDialog country={company.data.country} />
                  </div>
                )}

              <PortSection company={company.data} />

              <TextEnableSection company={company.data} />

              <RegistrationSection company={company.data} />
            </div>
          );
        })()
      )}
    </SettingsPage>
  );
}
