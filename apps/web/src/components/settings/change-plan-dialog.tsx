"use client";

import {
  billingCurrencyOf,
  formatMoney,
  PLAN_PRICE_CENTS,
  prepaidConversionCopy,
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
import { useChangePlan, usePrepayOffer, type PrepayOffer } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import { useMembers } from "@/lib/api/team";
import { PLAN_PRICING, type CompanyView, type PlanId } from "@/lib/api/types";
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
 * #583 — what happens to a prepaid year when the plan changes underneath it.
 *
 * The reader's actual fear is one sentence: "I paid for a year, do I lose it?"
 * Until now the answer arrived as a 409 after they pressed the button, which is
 * the worst possible order — a refusal reads as "you cannot", and this customer
 * both can and wants to pay us more.
 *
 * So the money is stated BEFORE the act, in three facts and no more: what the year
 * cost, how much of it is used, and what comes back. Three items is inside what a
 * reader holds at once; a fourth would be arithmetic they did not ask for.
 *
 * IT SAYS CREDIT, AND NEVER MONTHS. Stripe applies a credit balance to the whole
 * invoice, so a heavy overage month can consume it instead of the plan fee. "Two
 * months of Pro free" would be a promise we cannot keep; "$217.50 of credit, and it
 * comes off your next invoices" is exactly true. D131 records why the whole design
 * settles in money rather than months.
 *
 * The acknowledgement is deliberately NOT pre-ticked. Everywhere else in this
 * product a form arrives pre-filled to save the reader work — here the tick IS the
 * consent, and a consent that was already given is not one.
 *
 * Renders for nobody who has not prepaid, which is almost everybody. Same rule this
 * file already applies to reinstated numbers in `upgradeToast`: a panel for a rare
 * state must not become furniture on the common one.
 */
function PrepaidYearNotice({
  open,
  target,
  acknowledged,
  onAcknowledgedChange,
}: {
  open: NonNullable<PrepayOffer["open"]>;
  target: PlanId;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
}) {
  // The currency the year was COLLECTED in, which is what any figure drawn from
  // this row must be printed in — a year bought before the CAD option was filed is
  // genuinely USD even on a workspace that bills CAD today.
  const paid = billingCurrencyOf(open.currency);
  const credit = open.conversion
    ? formatMoney(open.conversion.credit_cents, paid)
    : null;
  const used = open.conversion?.consumed_months ?? null;
  // The sentences are the promise, so they come from the shared rule rather than
  // being typed out here — Kotlin and Swift read the same one, held to it by
  // generated parity vectors.
  const copy = prepaidConversionCopy(open.plan, target, credit);

  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <p className="text-sm font-medium">{copy.heading}</p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Paid up front</dt>
          <dd className="tabular-nums">{formatMoney(open.amount_cents, paid)}</dd>
        </div>
        {used !== null && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Months used</dt>
            <dd className="tabular-nums">{used} of 12</dd>
          </div>
        )}
        {credit && (
          <div className="flex justify-between gap-4 font-medium">
            <dt>Back on your account</dt>
            <dd className="tabular-nums">{credit}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-muted-foreground">{copy.explanation}</p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
        />
        <span>{copy.acknowledgement}</span>
      </label>
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
  // #583: ticked only by the reader, and only when a prepaid year is running.
  const [endPrepaid, setEndPrepaid] = useState(false);
  /**
   * Fetched only while the dialog is open, which is the boundary this hook's own
   * docblock asks for — answering it costs a Stripe round trip server-side, and
   * the billing page already polls enough.
   */
  const prepay = usePrepayOffer(open);
  const prepaidYear = prepay.data?.open ?? null;

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
    if (!next) {
      setError(null);
      // Closing the dialog withdraws the consent. Re-opening it must ask again
      // rather than remembering a tick from a conversation the reader abandoned.
      setEndPrepaid(false);
    }
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

        {prepaidYear && (
          <PrepaidYearNotice
            open={prepaidYear}
            target={target}
            acknowledged={endPrepaid}
            onAcknowledgedChange={setEndPrepaid}
          />
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
            disabled={
              changePlan.isPending ||
              (!upgrading && blocked) ||
              // #583: a prepaid year is never ended by a click that did not say
              // so. The server refuses without the flag anyway; disabling here is
              // what makes the refusal unreachable rather than a surprise.
              (prepaidYear !== null && !endPrepaid)
            }
            onClick={() => {
              setError(null);
              changePlan.mutate({ plan: target, convertPrepaid: endPrepaid }, {
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
