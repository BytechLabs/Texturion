"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NumberPicker } from "@/components/numbers/number-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useCreateCompany } from "@/lib/api/companies";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { browserTimezone } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { clearOnboardingDraft, writeOnboardingDraft } from "../local-draft";
import { StepError, StepLoading, StepShell } from "../step-shell";
import {
  draftOwesUsRegistration,
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
 */
export default function NumberStepPage() {
  const { state, ready } = useWizardStepGuard("number");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();

  const [mode, setMode] = useState<NumberMode>("new");
  const [country, setCountry] = useState<"US" | "CA">("US");
  const [chosenNumber, setChosenNumber] = useState<string | null>(null);
  const [usTexting, setUsTexting] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed from the saved draft once (resume).
  const { draft } = state;
  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    if (draft.mode) setMode(draft.mode);
    if (draft.country) setCountry(draft.country);
    if (draft.usTexting !== undefined) setUsTexting(draft.usTexting);
    if (draft.chosenNumber) setChosenNumber(draft.chosenNumber);
  }, [ready, seeded, draft]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("number", {
    ...state.snapshot,
    draft: { ...draft, country, usTexting },
  });
  const skipsRegistration = !draftOwesUsRegistration({
    country,
    usTexting,
  });

  function pickCountry(next: "US" | "CA") {
    setCountry(next);
    setChosenNumber(null); // numbers belong to one country
    setFormError(null);
  }

  async function onContinue() {
    setFormError(null);

    // D16 fork: bringing an existing number hands off to the port sub-wizard
    // (PORTING.md §8.1). We don't pick an area code here — the ported number's
    // own area code defaults `requested_area_code` at company creation
    // (PORTING.md correction 2). Country + US-texting choice are still needed
    // (they drive the registration branch), so keep them in the draft.
    if (mode === "port") {
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
    // The chosen number's own area code (NDC) is the requested area code — the
    // fallback if the exact number is taken by checkout time.
    const chosenAreaCode = chosenNumber.slice(2, 5);
    writeOnboardingDraft({
      name: draft.name,
      country,
      areaCode: chosenAreaCode,
      chosenNumber,
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
      const company = await createCompany.mutateAsync({
        name: (draft.name ?? "").trim(),
        country: "CA",
        requested_area_code: chosenAreaCode,
        chosen_number_e164: chosenNumber,
        us_texting_enabled: false,
        ...(timezone ? { timezone } : {}),
      });
      writeCompanyCookie(company.id);
      // The next step's guard resolves the company through GET /v1/me —
      // wait for the membership to be visible before navigating.
      await queryClient.invalidateQueries({ queryKey: keys.me });
      clearOnboardingDraft();
      trackOnboardingStepCompleted("number");
      router.push("/onboarding/plan");
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong on our end. Try again in a moment.",
      );
    }
  }

  return (
    <StepShell
      backHref="/onboarding/name"
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
        {/* D16 fork (PORTING.md §8.1): new number vs. bring my number. */}
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
            number from the live Telnyx list (the same picker settings uses). */}
        <div className={cn("space-y-2", mode === "port" && "hidden")}>
          <Label>Pick your number</Label>
          <NumberPicker
            key={country}
            country={country}
            initialAreaCode={draft.areaCode ?? null}
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
          disabled={createCompany.isPending}
        >
          {createCompany.isPending ? (
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
