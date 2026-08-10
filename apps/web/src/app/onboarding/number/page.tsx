"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  billingCurrencyOf,
  currencyForCountry,
  formatMoney,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";

import { NumberPicker, isFullNumber } from "@/components/numbers/number-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useT } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useCreateCompany } from "@/lib/api/companies";
import { useOnboardingUpdateCompany } from "@/lib/api/onboarding";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { browserTimezone } from "@/lib/format/time";
import {
  clearReferralCode,
  referralCodeForCreate,
} from "@/lib/referral/capture";
import {
  clearFirstTouch,
  firstTouchForCreate,
} from "@/lib/marketing/first-touch";
import { cn } from "@/lib/utils";

import { clearOnboardingDraft, writeOnboardingDraft } from "../local-draft";
import { StepError, StepLoading, StepShell } from "../step-shell";
import {
  draftOwesUsRegistration,
  previousStepHref,
  stepProgress,
  type NumberMode,
} from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

/**
 * G7 step 2: "Where do your customers text you?" — country (US/CA) + area
 * code picker with "(416) — Ontario"-style hints from the shared NANP table.
 * CA additionally answers the US-texting question (SPEC §4.2); a CA company
 * that declines US texting skips the registration wizard entirely, so THIS
 * screen collects the AUP and creates the company (POST /v1/companies).
 *
 * #79: this step stays editable until checkout. A customer who picked the wrong
 * country can step Back here and switch; when the company already exists (it was
 * created on this step for CA-only, or on the business step for US), Continue
 * PATCHes it pre-checkout instead of creating a second one.
 */
export default function NumberStepPage() {
  const t = useT();
  const { state, ready } = useWizardStepGuard("number");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();
  const updateCompany = useOnboardingUpdateCompany();

  const [mode, setMode] = useState<NumberMode>("new");
  const [country, setCountry] = useState<"US" | "CA">("US");
  const [chosenNumber, setChosenNumber] = useState<string | null>(null);
  const [usTexting, setUsTexting] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  // Held across the whole submit-then-navigate window so a double-click can't
  // create a second company (mutation isPending flips false the instant the
  // POST resolves, before the me refetch + router.push complete).
  const [submitting, setSubmitting] = useState(false);

  const { draft, company } = state;
  // Editing an existing pre-checkout company (stepped Back to switch country),
  // vs. a fresh signup that still lives in the local draft.
  const editing = company !== null;

  // Seed once from the company (when it exists) or the saved draft (resume).
  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    if (company) {
      // No number/area code is pre-filled (#78): the number is re-picked for the
      // possibly-new country. Porting is a create-time decision, so force "new".
      setMode("new");
      setCountry(company.country);
      setUsTexting(company.us_texting_enabled);
      return;
    }
    if (draft.mode) setMode(draft.mode);
    if (draft.country) setCountry(draft.country);
    if (draft.usTexting !== undefined) setUsTexting(draft.usTexting);
    // The pick is a full number (US) or an area code (CA/masked) — resume either.
    setChosenNumber(draft.chosenNumber ?? draft.areaCode ?? null);
  }, [ready, seeded, draft, company]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("number", {
    ...state.snapshot,
    draft: { ...draft, country, usTexting },
  });
  const skipsRegistration = !draftOwesUsRegistration({ country, usTexting });
  /**
   * #328 — what the US registration fee will cost THIS workspace.
   *
   * The company row is the authority when there is one: `billing_currency` is
   * the decision, set at creation and pinned once Stripe has a subscription,
   * and a screen that inferred a currency from a country would be a second
   * opinion about a fact we already store. It matters here specifically because
   * `api_create_company` writes the currency once and nothing updates it
   * afterwards, so a workspace that was created as US and then stepped Back to
   * Canada is still billed in USD. Reading the row is what keeps this sentence
   * agreeing with that invoice.
   *
   * Before the company exists this step is still a local draft, so the fallback
   * is the country the user just picked, which is the exact expression
   * `api_create_company` will evaluate a moment later. Not a guess: the same
   * rule, run early.
   *
   * NOT the marketing country signal. That one is for visitors; this person has
   * a workspace.
   */
  const feeCurrency = company
    ? billingCurrencyOf(company.billing_currency)
    : currencyForCountry(country);
  const busy = submitting || createCompany.isPending || updateCompany.isPending;
  // Honest Back: the nearest still-editable preceding step, or none (name locks
  // at creation, so an editing user has nothing reachable behind this step).
  const backHref = previousStepHref("number", state.snapshot) ?? undefined;

  function pickCountry(next: "US" | "CA") {
    setCountry(next);
    setChosenNumber(null); // numbers belong to one country
    setFormError(null);
  }

  function onError(cause: unknown) {
    setSubmitting(false); // re-enable Continue so the user can retry
    setFormError(
      cause instanceof ApiError ? cause.message : t("onboarding.genericError"),
    );
  }

  async function onContinue() {
    setFormError(null);

    // D16 fork: bringing an existing number hands off to the port sub-wizard
    // (PORTING.md §8.1). Only offered on a fresh signup (the mode selector is
    // hidden while editing an existing company). We don't pick an area code
    // here — the ported number's own area code defaults `requested_area_code`
    // at company creation (PORTING.md correction 2). Country + US-texting choice
    // are still needed (they drive the registration branch), so keep them.
    if (mode === "port") {
      setSubmitting(true);
      writeOnboardingDraft({
        name: draft.name,
        country,
        usTexting: country === "CA" ? usTexting : true,
        mode: "port",
      });
      trackOnboardingStepCompleted("number");
      router.push("/onboarding/port");
      return;
    }

    if (!chosenNumber) {
      setFormError(t("onboarding.pickNumberError"));
      return;
    }
    // A full-number pick (US) orders that exact number; an area-code pick (CA,
    // where Telnyx masks the digits) auto-assigns within it. Either way the
    // requested area code is the fallback / the assignment target.
    const full = isFullNumber(chosenNumber);
    const requestedAreaCode = full ? chosenNumber.slice(2, 5) : chosenNumber;
    // Latch now (after validation): held through create/PATCH + navigation.
    setSubmitting(true);

    // #79: editing an existing pre-checkout company — PATCH it (never create a
    // second one), then move forward on the path the possibly-new country
    // implies. The hook invalidates company/registration/me so the next step
    // re-routes when the country change flips whether US registration is owed.
    if (editing && state.companyId) {
      try {
        await updateCompany.mutateAsync({
          companyId: state.companyId,
          country,
          requested_area_code: requestedAreaCode,
          chosen_number_e164: full ? chosenNumber : null,
          us_texting_enabled: country === "CA" ? usTexting : true,
        });
        trackOnboardingStepCompleted("number");
        router.push(skipsRegistration ? "/onboarding/plan" : "/onboarding/business");
      } catch (cause) {
        onError(cause);
      }
      return;
    }

    writeOnboardingDraft({
      name: draft.name,
      country,
      areaCode: requestedAreaCode,
      chosenNumber: full ? chosenNumber : undefined,
      usTexting: country === "CA" ? usTexting : true,
      mode: "new",
    });

    if (!skipsRegistration) {
      trackOnboardingStepCompleted("number");
      router.push("/onboarding/business");
      return;
    }

    // CA, Canadian customers only: no registration wizard — create the
    // company here (SPEC §4.1 step 2).
    // D15: the creating browser's timezone rides along silently.
    const timezone = browserTimezone();
    try {
      const created = await createCompany.mutateAsync({
        name: (draft.name ?? "").trim(),
        country: "CA",
        requested_area_code: requestedAreaCode,
        ...(full ? { chosen_number_e164: chosenNumber } : {}),
        us_texting_enabled: false,
        ...(timezone ? { timezone } : {}),
        // #370: the crew size answered back on the name step.
        ...(draft.crewSize ? { crew_size: draft.crewSize } : {}),
        // #288: and how they say they heard about us.
        ...(draft.signupSource ? { signup_source: draft.signupSource } : {}),
        // #501: the link this signup arrived through, if it arrived through one.
        ...referralCodeForCreate(),
        // #296: which marketing page started this, if we recorded one.
        ...firstTouchForCreate(),
      });
      writeCompanyCookie(created.id);
      clearReferralCode();
      clearFirstTouch();
      // The next step's guard resolves the company through GET /v1/me —
      // wait for the membership to be visible before navigating.
      await queryClient.invalidateQueries({ queryKey: keys.me });
      clearOnboardingDraft();
      trackOnboardingStepCompleted("number");
      router.push("/onboarding/plan");
    } catch (cause) {
      onError(cause);
    }
  }

  return (
    <StepShell
      backHref={backHref}
      index={progress.index}
      total={progress.total}
      title={t("onboarding.numberTitle")}
      subtitle={
        mode === "port"
          ? t("onboarding.numberSubtitlePort")
          : t("onboarding.numberSubtitleNew")
      }
    >
      <div className="space-y-6">
        {/* D16 fork (PORTING.md §8.1): new number vs. bring my number. Hidden
            while editing an existing company — porting is a create-time choice. */}
        {!editing && (
          <fieldset className="space-y-2">
            <legend className="sr-only">
              {t("onboarding.numberTypeLegend")}
            </legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as NumberMode);
                setFormError(null);
              }}
              className="grid gap-3"
            >
              {(
                [
                  [
                    "new",
                    t("onboarding.modeNewLabel"),
                    t("onboarding.modeNewHint"),
                  ],
                  [
                    "port",
                    t("onboarding.modePortLabel"),
                    t("onboarding.modePortHint"),
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <Label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors duration-150 ease-out",
                    mode === value
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <RadioGroupItem value={value} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{label}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {/* Path B (keep number AND carrier) is deliberately not a third
                wizard fork — it's a Settings flow after signup. One honest
                mention here so landline owners know it exists. */}
            <p className="text-[13px] text-muted-foreground">
              {t("onboarding.landlineNote")}
            </p>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t("onboarding.countryLegend")}
          </legend>
          <RadioGroup
            value={country}
            onValueChange={(v) => pickCountry(v as "US" | "CA")}
            className="grid grid-cols-2 gap-3"
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
                  "flex h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 text-sm font-medium transition-colors duration-150 ease-out",
                  country === value
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

        {/* Choose-your-number: search an area code, then pick a real available
            number from the live Telnyx list (the same picker settings uses).
            No area code is pre-filled, and it resets on a country switch (#78):
            the picker starts on its area-code search, remounted per country. */}
        <div className={cn("space-y-2", mode === "port" && "hidden")}>
          <Label>{t("onboarding.pickNumberLabel")}</Label>
          <NumberPicker
            key={country}
            country={country}
            initialAreaCode={null}
            selected={chosenNumber}
            onSelect={(e164) => {
              setChosenNumber(e164);
              setFormError(null);
            }}
          />
        </div>

        {country === "CA" ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("onboarding.usTextingLegend")}
            </legend>
            <RadioGroup
              value={usTexting ? "yes" : "no"}
              onValueChange={(v) => setUsTexting(v === "yes")}
              className="grid gap-3"
            >
              {(
                [
                  ["yes", t("onboarding.usTextingYes")],
                  ["no", t("onboarding.usTextingNo")],
                ] as const
              ).map(([value, label]) => (
                <Label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors duration-150 ease-out",
                    (usTexting ? "yes" : "no") === value
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <RadioGroupItem value={value} />
                  {label}
                </Label>
              ))}
            </RadioGroup>
            <p className="text-[13px] text-muted-foreground">
              {t("onboarding.usTextingFeeNote", {
                fee: formatMoney(
                  US_REGISTRATION_FEE_CENTS[feeCurrency],
                  feeCurrency,
                ),
              })}
            </p>
          </fieldset>
        ) : null}

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          onClick={onContinue}
          disabled={busy}
        >
          {busy ? (
            t("onboarding.settingUpWorkspace")
          ) : mode === "port" ? (
            t("onboarding.continue")
          ) : (
            <>
              {t("onboarding.continue")}
              {chosenNumber ? <Check className="size-4" aria-hidden /> : null}
            </>
          )}
        </Button>
      </div>
    </StepShell>
  );
}
