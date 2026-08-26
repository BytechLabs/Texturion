"use client";

import { useState } from "react";

import {
  billingCurrencyOf,
  currencyForCountry,
  formatMoney,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { NumberPicker, isFullNumber } from "@/components/numbers/number-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useOnboardingUpdateCompany } from "@/lib/api/onboarding";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { areaCodeHint } from "../area-codes";

type Country = "US" | "CA";

/**
 * "Edit until checkout" (plan step): a compact, editable summary of the fields
 * that lock once the number is provisioned — workspace name, and the chosen
 * number (country + the specific picked number + the CA US-texting choice). All
 * save via PATCH /v1/company, gated to pre-checkout on the server; a country
 * change forces a matching new pick and the wizard re-routes. Number editing is
 * hidden for a port-in.
 */
export function WorkspaceSummary({
  companyId,
  name,
  country,
  chosenNumber,
  areaCode,
  usTexting,
  canEditNumber,
  billingCurrency,
}: {
  companyId: string;
  name: string;
  country: Country;
  chosenNumber: string | null;
  areaCode: string | null;
  usTexting: boolean;
  canEditNumber: boolean;
  /**
   * #328 — the company row's own `billing_currency`, so the fee this panel
   * quotes is the one the invoice will carry.
   *
   * Optional, and the fallback is `currencyForCountry(country)`, which is the
   * exact expression `api_create_company` evaluates when it writes the column.
   * For any workspace created since #328 the two therefore agree by
   * construction. They can only diverge for a workspace that was created BEFORE
   * the column existed and is somehow still pre-checkout, which the fallback
   * would over-quote; passing the row closes that.
   */
  billingCurrency?: BillingCurrency;
}) {
  const t = useT();
  const update = useOnboardingUpdateCompany();
  const [editing, setEditing] = useState<null | "name" | "number">(null);
  const [nameDraft, setNameDraft] = useState(name);
  const [draftCountry, setDraftCountry] = useState<Country>(country);
  const [draftChosen, setDraftChosen] = useState<string | null>(chosenNumber);
  const [draftUsTexting, setDraftUsTexting] = useState(usTexting);
  const [error, setError] = useState<string | null>(null);

  // #328: the row wins, and it is deliberately NOT re-derived from
  // `draftCountry`. Switching country in this editor PATCHes the country and
  // nothing else; no code path rewrites `billing_currency` after creation, so a
  // sentence that followed the draft would promise a currency the invoice never
  // uses. What is editable here and what is priced here are two different facts.
  const feeCurrency = billingCurrency
    ? billingCurrencyOf(billingCurrency)
    : currencyForCountry(country);
  const registrationFee = formatMoney(
    US_REGISTRATION_FEE_CENTS[feeCurrency],
    feeCurrency,
  );

  const areaHint = areaCode
    ? areaCodeHint(areaCode, country, t.locale)
    : null;
  // What the number line shows when not editing: the exact chosen number if the
  // user picked one, else the area code we'll auto-assign within.
  const numberLabel = chosenNumber
    ? formatPhone(chosenNumber)
    : areaHint
      ? areaHint.label
      : (areaCode ?? "—");

  function fail(cause: unknown) {
    setError(
      cause instanceof ApiError
        ? cause.message
        : t("onboarding.saveChangeFailed"),
    );
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (next.length === 0) {
      setError(t("onboarding.workspaceNameRequired"));
      return;
    }
    if (next === name) {
      setEditing(null);
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ companyId, name: next });
      setEditing(null);
    } catch (cause) {
      fail(cause);
    }
  }

  function openNumberEditor() {
    setDraftCountry(country);
    setDraftChosen(chosenNumber);
    setDraftUsTexting(usTexting);
    setError(null);
    setEditing("number");
  }

  function pickCountry(next: Country) {
    setDraftCountry(next);
    setDraftChosen(null); // numbers belong to one country
  }

  async function saveNumber() {
    if (!draftChosen) {
      setError(t("onboarding.pickNumberError"));
      return;
    }
    setError(null);
    // A full number (US) is ordered exactly; an area code (CA/masked) clears any
    // pick and auto-assigns within it.
    const full = isFullNumber(draftChosen);
    try {
      await update.mutateAsync({
        companyId,
        requested_area_code: full ? draftChosen.slice(2, 5) : draftChosen,
        chosen_number_e164: full ? draftChosen : null,
        ...(draftCountry !== country ? { country: draftCountry } : {}),
        ...(draftCountry === "CA" ? { us_texting_enabled: draftUsTexting } : {}),
      });
      setEditing(null);
    } catch (cause) {
      fail(cause);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-[15px] font-medium">
        {t("onboarding.workspaceTitle")}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t("onboarding.workspaceHint")}
      </p>

      <dl className="mt-4 space-y-3">
        {/* Workspace name */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <dt className="text-[13px] text-muted-foreground">
              {t("onboarding.workspaceNameLabel")}
            </dt>
            {editing === "name" ? (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-9"
                  aria-label={t("onboarding.workspaceNameLabel")}
                  maxLength={200}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={() => void saveName()}
                  disabled={update.isPending}
                >
                  {t("common.save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setNameDraft(name);
                    setError(null);
                  }}
                  disabled={update.isPending}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <dd className="mt-0.5 truncate text-sm font-medium">{name}</dd>
            )}
          </div>
          {editing !== "name" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNameDraft(name);
                setEditing("name");
                setError(null);
              }}
            >
              {t("onboarding.edit")}
            </Button>
          ) : null}
        </div>

        {/* Number: country + the chosen number (+ CA US-texting). Hidden for a port. */}
        {canEditNumber ? (
          <div className="border-t border-border pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <dt className="text-[13px] text-muted-foreground">
                  {t("onboarding.businessNumberLabel")}
                </dt>
                {editing !== "number" ? (
                  <dd className="mt-0.5 text-sm font-medium">
                    {country === "US"
                      ? t("onboarding.countryUs")
                      : t("onboarding.countryCa")}
                    {" · "}
                    <span className="tabular-nums">{numberLabel}</span>
                    {country === "CA" && usTexting ? (
                      <span className="text-muted-foreground">
                        {" "}
                        {t("onboarding.alsoTextsUs")}
                      </span>
                    ) : null}
                  </dd>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  editing === "number" ? setEditing(null) : openNumberEditor()
                }
                disabled={update.isPending}
              >
                {editing === "number"
                  ? t("common.cancel")
                  : t("onboarding.change")}
              </Button>
            </div>

            {editing === "number" ? (
              <div className="mt-3 space-y-3">
                <fieldset>
                  <legend className="text-[13px] text-muted-foreground">
                    {t("onboarding.countryLegend")}
                  </legend>
                  <RadioGroup
                    value={draftCountry}
                    onValueChange={(v) => pickCountry(v as Country)}
                    className="mt-1 grid grid-cols-2 gap-2"
                  >
                    {(
                      [
                        ["US", t("onboarding.countryUs")],
                        ["CA", t("onboarding.countryCa")],
                      ] as const
                    ).map(([value, label]) => (
                      <Label
                        key={value}
                        className={cn(
                          "flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                          draftCountry === value
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-accent",
                        )}
                      >
                        <RadioGroupItem value={value} />
                        {label}
                      </Label>
                    ))}
                  </RadioGroup>
                </fieldset>

                <NumberPicker
                  key={draftCountry}
                  country={draftCountry}
                  // #78: no default area code, and none carried across a country
                  // switch. A prior full-number pick still seeds its own code for
                  // review; otherwise the picker opens on its area-code search.
                  initialAreaCode={
                    draftChosen && isFullNumber(draftChosen)
                      ? draftChosen.slice(2, 5)
                      : null
                  }
                  selected={draftChosen}
                  onSelect={setDraftChosen}
                />

                {draftCountry === "CA" ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={draftUsTexting}
                      onChange={(e) => setDraftUsTexting(e.target.checked)}
                    />
                    <span>
                      {t("onboarding.alsoTextUsLabel")}
                      <span className="mt-0.5 block text-[13px] text-muted-foreground">
                        {t("onboarding.usTextingFeeShort", {
                          fee: registrationFee,
                        })}
                      </span>
                    </span>
                  </label>
                ) : null}

                <Button
                  className="w-full"
                  onClick={() => void saveNumber()}
                  disabled={update.isPending || !draftChosen}
                >
                  {update.isPending
                    ? t("common.saving")
                    : t("onboarding.saveNumber")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </dl>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
