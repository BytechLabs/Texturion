"use client";

import { ArrowRight, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatPhone } from "@/lib/format/phone";

import { writeOnboardingPortDraft } from "../../local-draft";
import { StepError, StepLoading, StepShell } from "../../step-shell";
import { usePortWizardGuard } from "../use-port-wizard";

/**
 * Port sub-step 2 (PORTING.md §8.1 step 2): the losing-carrier account details
 * that must match the current bill. Wireless numbers additionally need the
 * port-out PIN + the last 4 of the account holder's SSN/SIN (§2.2) — collected
 * with a plain "why we ask" and stored as last-4 only, never the full number.
 */
export default function PortCarrierPage() {
  const { onboarding, port, ready } = usePortWizardGuard("carrier");
  const router = useRouter();

  const [entityName, setEntityName] = useState("");
  const [authPersonName, setAuthPersonName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pinPasscode, setPinPasscode] = useState("");
  const [billingPhoneNumber, setBillingPhoneNumber] = useState("");
  const [ssnSinLast4, setSsnSinLast4] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    setEntityName(port.entityName ?? "");
    setAuthPersonName(port.authPersonName ?? "");
    setAccountNumber(port.accountNumber ?? "");
    setPinPasscode(port.pinPasscode ?? "");
    setBillingPhoneNumber(port.billingPhoneNumber ?? "");
    setSsnSinLast4(port.ssnSinLast4 ?? "");
  }, [ready, seeded, port]);

  if (onboarding.status === "error") {
    return <StepError onRetry={onboarding.retry} />;
  }
  if (!ready) return <StepLoading />;

  const country = onboarding.draft.country ?? "US";
  const isWireless = port.isWireless === true;
  const ssnSinLabel = country === "US" ? "SSN" : "SIN";

  function onContinue() {
    setError(null);
    if (!entityName.trim() || !authPersonName.trim() || !accountNumber.trim()) {
      setError("Fill in the account holder, authorized person, and account number.");
      return;
    }
    if (isWireless && !/^\d{4}$/.test(ssnSinLast4.trim())) {
      setError(`Enter the last 4 digits of the account holder's ${ssnSinLabel}.`);
      return;
    }
    if (isWireless && !pinPasscode.trim()) {
      setError("Enter the transfer PIN from your current carrier.");
      return;
    }
    writeOnboardingPortDraft({
      entityName: entityName.trim(),
      authPersonName: authPersonName.trim(),
      accountNumber: accountNumber.trim(),
      pinPasscode: pinPasscode.trim() || undefined,
      billingPhoneNumber: billingPhoneNumber.trim() || undefined,
      ssnSinLast4: isWireless ? ssnSinLast4.trim() : undefined,
    });
    router.push("/onboarding/port/address");
  }

  return (
    <StepShell
      backHref="/onboarding/port"
      index={2}
      total={5}
      title="Your current carrier account"
      subtitle="These come from your current provider — matching them to your latest bill is the surest way to a smooth transfer."
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="entity-name">Account holder name</Label>
          <Input
            id="entity-name"
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="The business or person on the bill"
            autoComplete="organization"
          />
          <p className="text-[13px] text-muted-foreground">
            Exactly as it appears on your current carrier bill.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="auth-person">Authorized person</Label>
          <Input
            id="auth-person"
            value={authPersonName}
            onChange={(e) => setAuthPersonName(e.target.value)}
            placeholder="Who's allowed to make account changes"
            autoComplete="name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="account-number">Account number</Label>
          <Input
            id="account-number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Your current carrier account number"
            autoComplete="off"
            inputMode="numeric"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="billing-phone">
            Billing phone number{" "}
            <span className="font-normal text-muted-foreground">
              (if different)
            </span>
          </Label>
          <Input
            id="billing-phone"
            value={billingPhoneNumber}
            onChange={(e) => setBillingPhoneNumber(e.target.value)}
            placeholder={
              port.phoneE164 ? formatPhone(port.phoneE164) : "(416) 555-0182"
            }
            inputMode="tel"
            autoComplete="tel"
            className="tabular-nums"
          />
          <p className="text-[13px] text-muted-foreground">
            The main number on the account, if it isn&apos;t the one
            you&apos;re transferring.
          </p>
        </div>

        {isWireless ? (
          <div className="space-y-5 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-2">
              <Info
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden
              />
              <p className="text-[13px] text-muted-foreground">
                This is a mobile number, so your carrier needs two extra
                details to release it. We only ever store the last 4 digits of
                the {ssnSinLabel} — never the full number.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">Transfer PIN / passcode</Label>
              <Input
                id="pin"
                value={pinPasscode}
                onChange={(e) => setPinPasscode(e.target.value)}
                placeholder="Your carrier can give you this"
                autoComplete="off"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="ssn-last4"
                className="flex items-center gap-1.5"
              >
                Last 4 of the account holder&apos;s {ssnSinLabel}
                <Tooltip>
                  <TooltipTrigger
                    aria-label={`Why we ask for the ${ssnSinLabel} last 4`}
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Info className="size-3.5" strokeWidth={1.75} aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Mobile carriers verify the account holder&apos;s identity
                    before releasing a number. We pass only the last 4 digits to
                    the carrier and store only those 4 — never the full{" "}
                    {ssnSinLabel}.
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="ssn-last4"
                value={ssnSinLast4}
                onChange={(e) =>
                  setSsnSinLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="1234"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                className="w-28 tabular-nums"
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button size="lg" className="w-full" onClick={onContinue}>
          Continue
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </StepShell>
  );
}
