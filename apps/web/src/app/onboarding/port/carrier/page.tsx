"use client";

import { ArrowRight, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { formatPhone } from "@/lib/format/phone";

import { StepError, StepLoading, StepShell } from "../../step-shell";
import { portStepProgress, usePortWizardGuard } from "../use-port-wizard";

/**
 * Port sub-step 2 (PORTING.md §8.1 step 2): the losing-carrier account details
 * that must match the current bill, including a port-out PIN for wireless.
 */
export default function PortCarrierPage() {
  const t = useT();
  const { onboarding, port, ready } = usePortWizardGuard("carrier");
  const router = useRouter();

  const [entityName, setEntityName] = useState("");
  const [authPersonName, setAuthPersonName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pinPasscode, setPinPasscode] = useState("");
  const [billingPhoneNumber, setBillingPhoneNumber] = useState("");
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
  }, [ready, seeded, port]);

  if (onboarding.status === "error") {
    return <StepError onRetry={onboarding.handleRetry} />;
  }
  if (!ready || !onboarding.snapshot) return <StepLoading />;

  const isWireless = port.isWireless === true;
  const progress = portStepProgress(onboarding.snapshot);

  function onContinue() {
    setError(null);
    if (!entityName.trim() || !authPersonName.trim() || !accountNumber.trim()) {
      setError(t("onboarding.portCarrierMissing"));
      return;
    }
    if (isWireless && !pinPasscode.trim()) {
      setError(t("onboarding.portPinError"));
      return;
    }
    onboarding.savePortDraft({
      entityName: entityName.trim(),
      authPersonName: authPersonName.trim(),
      accountNumber: accountNumber.trim(),
      pinPasscode: pinPasscode.trim() || undefined,
      billingPhoneNumber: billingPhoneNumber.trim() || undefined,
    });
    trackOnboardingStepCompleted("port_carrier");
    router.push("/onboarding/port/address");
  }

  return (
    <StepShell
      step="port_carrier"
      backHref="/onboarding/port"
      index={progress.index}
      total={progress.total}
      title={t("onboarding.portCarrierTitle")}
      subtitle={t("onboarding.portCarrierSubtitle")}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="entity-name">
            {t("onboarding.portEntityNameLabel")}
          </Label>
          <Input
            id="entity-name"
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder={t("onboarding.portEntityNamePlaceholder")}
            autoComplete="organization"
          />
          <p className="text-[13px] text-muted-foreground">
            {t("onboarding.portEntityNameHint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="auth-person">
            {t("onboarding.portAuthPersonLabel")}
          </Label>
          <Input
            id="auth-person"
            value={authPersonName}
            onChange={(e) => setAuthPersonName(e.target.value)}
            placeholder={t("onboarding.portAuthPersonPlaceholder")}
            autoComplete="name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="account-number">
            {t("onboarding.portAccountNumberLabel")}
          </Label>
          <Input
            id="account-number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={t("onboarding.portAccountNumberPlaceholder")}
            autoComplete="off"
            inputMode="numeric"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="billing-phone">
            {t("onboarding.portBillingPhoneLabel")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("onboarding.ifDifferent")}
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
            {t("onboarding.portBillingPhoneHint")}
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
                {t("onboarding.portWirelessNote")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">{t("onboarding.portPinLabel")}</Label>
              <Input
                id="pin"
                value={pinPasscode}
                onChange={(e) => setPinPasscode(e.target.value)}
                placeholder={t("onboarding.portPinPlaceholder")}
                autoComplete="off"
                inputMode="numeric"
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
          {t("onboarding.continue")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </StepShell>
  );
}
