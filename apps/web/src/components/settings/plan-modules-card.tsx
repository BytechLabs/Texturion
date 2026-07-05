"use client";

import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useModules, useSetModule } from "@/lib/api/billing";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * #12 plan builder: turn add-on modules on/off on the live subscription. Each
 * toggle prorates immediately; disabling an add-on also switches off whatever
 * it gated (handled server-side). Only modules whose Stripe price is
 * provisioned are shown.
 */
export function PlanModulesCard() {
  const modules = useModules();
  const setModule = useSetModule();

  return (
    <SettingsCard
      title="Add-ons"
      description="Turn extra features on or off — added to your plan and billed as you go."
    >
      {modules.isPending ? (
        <div className="space-y-2" aria-label="Loading add-ons">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : modules.isError ? (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your add-ons.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void modules.refetch()}
          >
            Try again
          </button>
        </p>
      ) : (
        <div className="space-y-2">
          {modules.data.modules
            // regions_ca is inert in today's single-region model (a company's
            // numbers are fixed to its own country), so it isn't offered yet.
            .filter((mod) => mod.available && mod.id !== "regions_ca")
            .map((mod) => {
              const busy =
                setModule.isPending && setModule.variables?.module === mod.id;
              return (
                <div
                  key={mod.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{mod.label}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {dollars(mod.monthly_cents)}/mo
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {mod.blurb}
                    </p>
                  </div>
                  <Switch
                    checked={mod.enabled}
                    disabled={setModule.isPending}
                    aria-label={`${mod.label} add-on`}
                    onCheckedChange={(next) =>
                      setModule.mutate(
                        { module: mod.id, enabled: next },
                        {
                          onError: (cause) =>
                            toast.error(
                              cause instanceof Error
                                ? cause.message
                                : "We couldn't update that add-on — try again.",
                            ),
                        },
                      )
                    }
                    data-busy={busy || undefined}
                  />
                </div>
              );
            })}
        </div>
      )}
    </SettingsCard>
  );
}
