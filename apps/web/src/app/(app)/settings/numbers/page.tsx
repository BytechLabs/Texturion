"use client";

import { NumberCard } from "@/components/settings/number-card";
import { ProvisionNumberDialog } from "@/components/settings/provision-number-dialog";
import { RegistrationSection } from "@/components/settings/registration-section";
import { LoadError, SettingsPage } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useNumbers } from "@/lib/api/numbers";
import { useActiveCompany } from "@/lib/company/provider";

/** SPEC §2: Pro includes 2 numbers, Starter 1. */
const PLAN_NUMBER_LIMIT = { starter: 1, pro: 2 } as const;

export default function NumbersSettingsPage() {
  const { role } = useActiveCompany();
  const company = useCompany();
  const numbers = useNumbers();

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
        <div className="space-y-6">
          {numbers.data.data.length === 0 ? (
            <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">
              No number yet — it&apos;s created automatically when your
              subscription starts.
            </p>
          ) : (
            numbers.data.data.map((number) => (
              <NumberCard key={number.id} number={number} />
            ))
          )}

          {(role === "owner" || role === "admin") &&
            company.data.plan === "pro" &&
            numbers.data.data.filter((n) => n.status !== "released").length <
              PLAN_NUMBER_LIMIT.pro && (
              <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Pro includes a second number — handy for a second crew or
                  service area.
                </p>
                <ProvisionNumberDialog country={company.data.country} />
              </div>
            )}

          <RegistrationSection company={company.data} />
        </div>
      )}
    </SettingsPage>
  );
}
