"use client";

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
import type { CompanyView } from "@/lib/api/types";

/** SPEC §2 Starter limits — what a downgrade must fit into. */
const STARTER_LIMITS = { seats: 3, numbers: 1 };

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
            <>Couldn&apos;t check your member count. Try again.</>
          ) : seatsOk ? (
            <>Up to 3 members; you have {activeMembers}.</>
          ) : (
            <>
              Starter includes 3 members; you have {activeMembers} active.{" "}
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
              Pro is $79/mo: 2,500 outgoing texts included, 10 seats, and a
              second phone number. You&apos;re charged the prorated difference
              for the rest of this period today.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Starter is $29/mo: 500 outgoing texts included, 3 seats, 1
              number.
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
                      ? "You're on Pro. The extra allowance starts now."
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
