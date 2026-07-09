"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NumberPicker, isFullNumber } from "@/components/numbers/number-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useCreateCompany } from "@/lib/api/companies";
import { useOnboardingUpdateCompany } from "@/lib/api/onboarding";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { browserTimezone } from "@/lib/format/time";
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
      cause instanceof ApiError
        ? cause.message
        : "Something went wrong on our end. Try again in a moment.",
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
      setFormError("Pick a number to continue.");
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
      });
      writeCompanyCookie(created.id);
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
      title="How do you want your business number?"
      subtitle={
        mode === "port"
          ? "Bring the number your customers already know. It keeps working until the switch completes."
          : "Get a fresh local number, or bring the one that's on your trucks and your listing."
      }
    >
      <div className="space-y-6">
        {/* D16 fork (PORTING.md §8.1): new number vs. bring my number. Hidden
            while editing an existing company — porting is a create-time choice. */}
        {!editing && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Number type</legend>
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
                    "Get a new number",
                    "We set up a fresh local number for your area.",
                  ],
                  [
                    "port",
                    "Bring my existing number",
                    "Transfer the number you already use. It's free.",
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
              Have a landline you&apos;d rather keep with its current carrier?
              After signup you can add texting to it from Settings → Numbers.
              Calls don&apos;t change, and the carrier review takes a few
              business days.
            </p>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Country</legend>
          <RadioGroup
            value={country}
            onValueChange={(v) => pickCountry(v as "US" | "CA")}
            className="grid grid-cols-2 gap-3"
          >
            {(
              [
                ["US", "United States"],
                ["CA", "Canada"],
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
          <Label>Pick your number</Label>
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
              Do you also text customers with US numbers?
            </legend>
            <RadioGroup
              value={usTexting ? "yes" : "no"}
              onValueChange={(v) => setUsTexting(v === "yes")}
              className="grid gap-3"
            >
              {(
                [
                  ["yes", "Yes, some of our customers are in the US"],
                  ["no", "No, Canadian customers only"],
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
              US texting needs a one-time $29 carrier registration. You can
              turn it on later in Settings.
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
            "Setting up your workspace…"
          ) : mode === "port" ? (
            "Continue"
          ) : (
            <>
              Continue
              {chosenNumber ? <Check className="size-4" aria-hidden /> : null}
            </>
          )}
        </Button>
      </div>
    </StepShell>
  );
}
