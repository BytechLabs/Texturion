"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ModuleCard } from "@/components/billing/module-card";
import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { type BillingModule, useModules, useSetModule } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import {
  describeModuleToggle,
  formatMonthlyCents,
} from "@/lib/settings/module-billing";

/** A toggle waiting for the owner's confirmation (#45). */
interface PendingToggle {
  module: BillingModule;
  /** The state the user is switching TO. */
  enable: boolean;
}

/**
 * #12 plan builder: turn add-on modules on/off on the live subscription. The
 * rows come straight from GET /v1/billing/modules — the API MODULE_CATALOG is
 * the single source for labels/prices/details (#59); nothing here is
 * hand-copied. Every toggle is confirmed first (#45) with the real billing
 * consequence: enabling invoices a prorated charge today; disabling turns the
 * module off immediately and — only if the add-on is actually billed (a
 * grandfathered legacy module has no Stripe line item and therefore no
 * credit; see lib/settings/module-billing.ts) — credits the unused
 * remainder. Only modules whose Stripe price is provisioned are shown.
 */
export function PlanModulesCard() {
  const modules = useModules();
  const setModule = useSetModule();
  const [pending, setPending] = useState<PendingToggle | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // regions_ca is inert in today's single-region model (a company's numbers
  // are fixed to its own country), so it isn't offered yet. #134/D42: with
  // voice retired into every plan, this can leave NOTHING to toggle — then
  // the whole card hides (loading/error states still render: an owner mid-
  // fetch must not watch a card blink away).
  const visibleModules = (modules.data?.modules ?? []).filter(
    (mod) => mod.available && mod.id !== "regions_ca",
  );
  if (modules.isSuccess && visibleModules.length === 0) return null;

  // Derived from `pending` so the dialog copy stays put during the close
  // animation instead of flashing empty.
  const change = pending
    ? describeModuleToggle({
        label: pending.module.label,
        monthlyCents: pending.module.monthly_cents,
        enable: pending.enable,
      })
    : null;

  function request(module: BillingModule, enable: boolean) {
    setPending({ module, enable });
    setError(null);
    setConfirming(true);
  }

  function confirm() {
    if (!pending) return;
    const { module, enable } = pending;
    // A retry after an error starts fresh — don't show the stale message
    // under the "Saving…" state.
    setError(null);
    setModule.mutate(
      { module: module.id, enabled: enable },
      {
        onSuccess: () => {
          setConfirming(false);
          // The credit is conditional: grandfathered legacy modules were
          // never billed, so promising one unconditionally would be false
          // for that whole cohort (see lib/settings/module-billing.ts).
          toast.success(
            enable
              ? `${module.label} added. The prorated charge is on today's invoice.`
              : `${module.label} turned off. If it was on your bill, the unused time is credited toward your next invoice.`,
          );
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "We couldn't update that add-on. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Add-ons"
      description="Turn extra features on or off. Changes prorate to today, so you never pay for time you didn't have them."
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
          {visibleModules.map((mod) => (
            // #45: no instant billing from a single tap — the card proposes;
            // the dialog below states the prorated charge or credit and the
            // owner confirms.
            <ModuleCard
              key={mod.id}
              label={mod.label}
              price={formatMonthlyCents(mod.monthly_cents)}
              blurb={mod.blurb}
              detail={mod.detail}
              on={mod.enabled}
              disabled={setModule.isPending}
              onToggle={() => request(mod, !mod.enabled)}
            />
          ))}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{change?.title}</DialogTitle>
            <DialogDescription>{change?.summary}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button disabled={setModule.isPending} onClick={confirm}>
              {setModule.isPending ? "Saving…" : change?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
