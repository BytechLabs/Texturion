"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";

import { writeOnboardingPortDraft } from "../../local-draft";
import { StepError, StepLoading, StepShell } from "../../step-shell";
import { portStepProgress, usePortWizardGuard } from "../use-port-wizard";

/**
 * Port sub-step 3 (PORTING.md §8.1 step 3): the SERVICE address on file with
 * the losing carrier — not the billing address. An address mismatch is the #1
 * rejection cause, so the copy says so plainly.
 */
export default function PortAddressPage() {
  const t = useT();
  const { onboarding, port, ready } = usePortWizardGuard("address");
  const router = useRouter();

  const [street, setStreet] = useState("");
  const [extended, setExtended] = useState("");
  const [locality, setLocality] = useState("");
  const [adminArea, setAdminArea] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    setStreet(port.serviceStreet ?? "");
    setExtended(port.serviceExtended ?? "");
    setLocality(port.serviceLocality ?? "");
    setAdminArea(port.serviceAdminArea ?? "");
    setPostalCode(port.servicePostalCode ?? "");
  }, [ready, seeded, port]);

  if (onboarding.status === "error") {
    return <StepError onRetry={onboarding.retry} />;
  }
  if (!ready || !onboarding.snapshot) return <StepLoading />;

  const country = onboarding.draft.country ?? "US";
  const regionLabel =
    country === "US"
      ? t("onboarding.stateLabel")
      : t("onboarding.provinceLabel");
  const postalLabel =
    country === "US" ? t("onboarding.zipLabel") : t("onboarding.postalLabel");
  const progress = portStepProgress(onboarding.snapshot);

  function onContinue() {
    setError(null);
    if (
      !street.trim() ||
      !locality.trim() ||
      !adminArea.trim() ||
      !postalCode.trim()
    ) {
      setError(
        t("onboarding.portAddressMissing", {
          region: regionLabel.toLowerCase(),
          postal: postalLabel.toLowerCase(),
        }),
      );
      return;
    }
    writeOnboardingPortDraft({
      serviceStreet: street.trim(),
      serviceExtended: extended.trim() || undefined,
      serviceLocality: locality.trim(),
      serviceAdminArea: adminArea.trim(),
      servicePostalCode: postalCode.trim(),
    });
    router.push("/onboarding/port/timing");
  }

  return (
    <StepShell
      backHref="/onboarding/port/carrier"
      index={progress.index}
      total={progress.total}
      title={t("onboarding.portAddressTitle")}
      subtitle={t("onboarding.portAddressSubtitle")}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="street">{t("onboarding.streetLabel")}</Label>
          <Input
            id="street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            autoComplete="street-address"
            placeholder={t("onboarding.streetPlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="extended">
            {t("onboarding.suiteLabel")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("onboarding.optional")}
            </span>
          </Label>
          <Input
            id="extended"
            value={extended}
            onChange={(e) => setExtended(e.target.value)}
            autoComplete="address-line2"
            placeholder={t("onboarding.suitePlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="locality">{t("onboarding.cityLabel")}</Label>
          <Input
            id="locality"
            value={locality}
            onChange={(e) => setLocality(e.target.value)}
            autoComplete="address-level2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admin-area">{regionLabel}</Label>
            <Input
              id="admin-area"
              value={adminArea}
              onChange={(e) => setAdminArea(e.target.value)}
              autoComplete="address-level1"
              placeholder={country === "US" ? "CO" : "ON"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postal-code">{postalLabel}</Label>
            <Input
              id="postal-code"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              autoComplete="postal-code"
              inputMode={country === "US" ? "numeric" : "text"}
              className="tabular-nums"
            />
          </div>
        </div>

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
