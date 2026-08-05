"use client";

import {
  billingCurrencyOf,
  formatMoney,
  PLAN_PRICE_CENTS,
} from "@loonext/shared";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangePlan } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import { useMembers } from "@/lib/api/team";
import { PLAN_PRICING, type CompanyView } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/** SPEC §2 Starter limits — what a downgrade must fit into. Derived from the
 *  shared PLAN_PRICING so a seat retune (e.g. #83) can't leave this stale. */
const STARTER_LIMITS = {
  seats: PLAN_PRICING.starter.seats,
  numbers: PLAN_PRICING.starter.numbers,
};

function Requirement({
  met,
  children,
}: {
  met: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {met ? (
        <Check
          className="mt-0.5 size-4 shrink-0 text-success"
          strokeWidth={2}
          aria-hidden
        />
      ) : (
        <X
          className="mt-0.5 size-4 shrink-0 text-destructive"
          strokeWidth={2}
          aria-hidden
        />
      )}
      <span>{children}</span>
    </li>
  );
}

function DowngradeBody({
  company,
  onBlockedChange,
}: {
  company: CompanyView;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const members = useMembers();

  const activeNumbers = company.numbers.filter(
    (n) => n.status !== "released",
  ).length;
  const activeMembers =
    members.isPending || members.isError
      ? null
      : members.data.data.filter((m) => m.deactivated_at === null).length;

  const numbersOk = activeNumbers <= STARTER_LIMITS.numbers;
  const seatsOk = activeMembers !== null && activeMembers <= STARTER_LIMITS.seats;
  const blocked = !numbersOk || !seatsOk;

  useEffect(() => {
    onBlockedChange(blocked);
  }, [blocked, onBlockedChange]);

  if (members.isPending) {
    return <Skeleton className="h-16 w-full" />;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        <Requirement met={numbersOk}>
          {numbersOk ? (
            <>1 phone number. You&apos;re set.</>
          ) : (
            <>
              Starter includes 1 phone number; you have {activeNumbers}.{" "}
              <Link
                href="/settings/numbers"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Release {activeNumbers - STARTER_LIMITS.numbers === 1 ? "one" : `${activeNumbers - STARTER_LIMITS.numbers}`} first
              </Link>
              .
            </>
          )}
        </Requirement>
        <Requirement met={seatsOk}>
          {activeMembers === null ? (
            <>
              Couldn&apos;t check your member count.{" "}
              <button
                type="button"
                onClick={() => void members.refetch()}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Try again
              </button>
            </>
          ) : seatsOk ? (
            <>Up to {STARTER_LIMITS.seats} members; you have {activeMembers}.</>
          ) : (
            <>
              Starter includes {STARTER_LIMITS.seats} members; you have{" "}
              {activeMembers} active.{" "}
              <Link
                href="/settings/team"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Deactivate {activeMembers - STARTER_LIMITS.seats}
              </Link>{" "}
              first.
            </>
          )}
        </Requirement>
      </ul>
      <p className="text-sm text-muted-foreground">
        The change happens at the end of your current period. You keep Pro
        until then, and nothing is refunded mid-period.
      </p>
    </div>
  );
}

/**
 * What to say after an upgrade lands (#523).
 *
 * Pro's bigger allowance reinstates numbers that were on hold, and the server
 * reports which ones. Saying so matters more than it looks: the owner pressed
 * Upgrade because a line was dead, and a generic "You're on Pro" leaves them to
 * go and check whether the thing they actually paid to fix is fixed. Naming the
 * number closes that loop in the same breath as the charge.
 *
 * An ORDINARY upgrade — nothing held, which is almost all of them — keeps the
 * original sentence exactly. A reader with no numbers on hold must never be
 * told anything about holds; that is how a feature for a rare state becomes
 * noise on a common one.
 */
export function upgradeToast(
  reinstated: readonly { number_e164: string | null }[],
): string {
  if (reinstated.length === 0) {
    return "You're on Pro. The extra allowance starts now.";
  }
  const named = reinstated
    .map((row) => row.number_e164)
    .filter((value): value is string => typeof value === "string" && value !== "");
  // One held number is the overwhelmingly common case and deserves its name —
  // "(415) 555-0102 is back" is a fact the reader can verify at a glance. Past
  // one, the list stops being readable in a toast and the count carries it.
  if (reinstated.length === 1 && named.length === 1) {
    return `You're on Pro, and ${formatPhone(named[0])} is back.`;
  }
  return `You're on Pro, and ${reinstated.length} numbers are back.`;
}

/**
 * Change-plan dialog (G8 Billing, SPEC §9): upgrade is immediate with a
 * proration note; downgrade lists exactly what must be released and blocks
 * until it fits — the API's 409 message is surfaced verbatim if it still
 * disagrees.
 */
export function ChangePlanDialog({ company }: { company: CompanyView }) {
  const changePlan = useChangePlan();
  const [open, setOpen] = useState(false);
  // Downgrades stay blocked until the seat/number check confirms they fit.
  const [blocked, setBlocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const target = company.plan === "pro" ? "starter" : "pro";
  const upgrading = target === "pro";
  // #328: the price of the plan they're moving TO, in the currency this
  // workspace is actually charged in. Both branches quote the target, so
  // there is one figure rather than two that can drift apart. A Canadian
  // owner reading a US price here would be reading it beside a Canadian
  // invoice, on the screen where the number is the whole decision.
  const currency = billingCurrencyOf(company.billing_currency);
  const targetPrice = formatMoney(PLAN_PRICE_CENTS[currency][target], currency);

  function reset(next: boolean) {
    if (!next) setError(null);
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline">
          {upgrading ? "Upgrade to Pro" : "Switch to Starter"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {upgrading ? "Upgrade to Pro?" : "Switch to Starter?"}
          </DialogTitle>
          {upgrading ? (
            <DialogDescription>
              Pro is {targetPrice}/mo: a bigger fair-use texting allowance,{" "}
              {PLAN_PRICING.pro.seats} seats, and a second phone number.
              You&apos;re charged the prorated difference for the rest of this
              period today.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Starter is {targetPrice}/mo: texting for a small crew under fair
              use,{" "}
              {STARTER_LIMITS.seats} seats, 1 number.
            </DialogDescription>
          )}
        </DialogHeader>

        {!upgrading && (
          <DowngradeBody company={company} onBlockedChange={setBlocked} />
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Never mind
          </Button>
          <Button
            disabled={changePlan.isPending || (!upgrading && blocked)}
            onClick={() => {
              setError(null);
              changePlan.mutate(target, {
                onSuccess: (result) => {
                  reset(false);
                  toast.success(
                    result.effective === "now"
                      ? upgradeToast(result.reinstated ?? [])
                      : `Starter starts ${new Date(result.effective_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. You keep Pro until then.`,
                  );
                },
                onError: (cause) =>
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Couldn't change the plan. Try again.",
                  ),
              });
            }}
          >
            {changePlan.isPending
              ? "Changing…"
              : upgrading
                ? "Upgrade to Pro"
                : "Switch at period end"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
