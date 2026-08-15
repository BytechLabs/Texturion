"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  CREW_SIZE_BUCKETS,
  CREW_SIZE_LABELS,
  SIGNUP_SOURCES,
  SIGNUP_SOURCE_HINT,
  SIGNUP_SOURCE_LABELS,
  SIGNUP_SOURCE_PROMPT,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useT, type Translate } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { cn } from "@/lib/utils";

import { crewFitCopy, crewFitPrompt } from "../crew-copy";
import { writeOnboardingDraft } from "../local-draft";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

/*
 * A factory rather than a module-level constant: both messages are read under
 * the field by the person filling it in, so they are copy and belong in the
 * catalogue.
 */
function buildSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("onboarding.companyNameRequired"))
      .max(200, t("onboarding.companyNameTooLong")),
    // #370: optional on purpose. A signup that skips it is a signup we still
    // want, and the column keeps "never asked" distinguishable from "solo".
    crewSize: z.enum(CREW_SIZE_BUCKETS).optional(),
    // #288: optional for the same reason, and it is the ONLY signal that can
    // see word of mouth. An owner told about us at a supply counter who then
    // searches for the name arrives with no landing path, no referrer and no
    // campaign — every passive measure reads them as direct traffic.
    signupSource: z.enum(SIGNUP_SOURCES).optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/**
 * G7 step: company name. Local until POST /v1/companies (the create call
 * needs name + country + area code + AUP together).
 *
 * #370 adds the crew-size question here rather than anywhere later, for two
 * reasons. It is the only pre-company step with room, so the answer rides the
 * local draft to whichever of the three creation call sites fires (number,
 * business, port) without a second round trip. And it is the cheapest screen in
 * the funnel to add a tap to.
 *
 * #288 adds "how did you hear about us?" on the same reasoning and to the same
 * draft. The screen is now one typed field and two rows of chips, and both chip
 * rows are skippable — the compliance step is the wrong home for a question no
 * carrier requires, and a marketing question next to "upload your LOA" reads as
 * badly as it sounds.
 *
 * Applying: Smart Personalization (the answer produces an immediate,
 * personalised outcome rather than disappearing into analytics), Chunking (four
 * buckets, inside the 3-4 the brain holds), Zen of Clarity (chips, not a number
 * field), and the Safety Principle (the chips are visually the same control the
 * business step already uses for its yes/no fork).
 *
 * The one Smart Defaults deviation, named once: no bucket is pre-selected.
 * Pre-filling is normally right and here it would be a lie, because the stored
 * column deliberately keeps "never asked" apart from "solo" and a default would
 * write an answer nobody gave. The friction that rule exists to remove is
 * TYPING, and the chips already removed it.
 */
export default function CompanyNamePage() {
  const t = useT();
  const { state, ready } = useWizardStepGuard("name");
  const router = useRouter();

  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", crewSize: undefined, signupSource: undefined },
  });

  // Prefill from a saved draft once resume state is in.
  const draftName = state.draft.name ?? "";
  const draftCrewSize = state.draft.crewSize;
  const draftSignupSource = state.draft.signupSource;
  useEffect(() => {
    if (draftName && form.getValues("name") === "") {
      form.reset({
        name: draftName,
        crewSize: draftCrewSize,
        signupSource: draftSignupSource,
      });
    }
  }, [draftName, draftCrewSize, draftSignupSource, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("name", state.snapshot);
  const chosenCrew = form.watch("crewSize");

  function onSubmit(values: FormValues) {
    writeOnboardingDraft({
      name: values.name,
      ...(values.crewSize ? { crewSize: values.crewSize } : {}),
      ...(values.signupSource ? { signupSource: values.signupSource } : {}),
    });
    trackOnboardingStepCompleted("name");
    router.push("/onboarding/number");
  }

  return (
    <StepShell
      index={progress.index}
      total={progress.total}
      title={t("onboarding.nameTitle")}
      subtitle={t("onboarding.nameSubtitle")}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.companyNameLabel")}</FormLabel>
                <FormControl>
                  <Input
                    autoFocus
                    autoComplete="organization"
                    placeholder={t("onboarding.companyNamePlaceholder")}
                    className="h-12 text-base"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t("onboarding.companyNameHint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="crewSize"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.crewSizeLabel")}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    className="grid grid-cols-2 gap-3"
                  >
                    {CREW_SIZE_BUCKETS.map((bucket) => (
                      <Label
                        key={bucket}
                        className={cn(
                          "flex h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-center text-sm font-medium transition-colors duration-150 ease-out",
                          // The radio is visually hidden, so the chip has to
                          // wear its focus ring. Without this a keyboard user
                          // arrowing through the row sees nothing move.
                          "focus-within:ring-[3px] focus-within:ring-ring",
                          field.value === bucket
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-accent",
                        )}
                      >
                        {/* The radio itself carries the keyboard and screen
                            reader behaviour; the chip carries the looks. Four
                            visible dots beside four short labels is clutter the
                            two-option fork on the business step can afford and
                            this row cannot. */}
                        <RadioGroupItem value={bucket} className="sr-only" />
                        {CREW_SIZE_LABELS[bucket]}
                      </Label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormDescription>
                  {chosenCrew ? crewFitCopy(chosenCrew, t) : crewFitPrompt(t)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* #288: the cheap step the issue asks for before amplifying a
              channel — "ask new signups how they heard about us, and find out
              whether this channel exists". Passive attribution structurally
              cannot: a plumber told about us at a supply counter who searches
              for the name a week later lands on '/' with nothing attached.

              *Applying: Chunking* — four answers, inside the three-to-four the
              brain holds, each mapping to a decision we would actually make.
              *Zen of Clarity* — the same chips as the row above it, so this
              reads as one more tap rather than a new kind of control.

              No default, and the same Smart Defaults deviation the crew-size
              row names: pre-selecting would write an answer nobody gave, and
              the column deliberately keeps "never asked" apart from every
              reply. */}
          <FormField
            control={form.control}
            name="signupSource"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(SIGNUP_SOURCE_PROMPT)}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    className="grid grid-cols-2 gap-3"
                  >
                    {SIGNUP_SOURCES.map((source) => (
                      <Label
                        key={source}
                        className={cn(
                          "flex h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-center text-sm font-medium transition-colors duration-150 ease-out",
                          "focus-within:ring-[3px] focus-within:ring-ring",
                          field.value === source
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-accent",
                        )}
                      >
                        <RadioGroupItem value={source} className="sr-only" />
                        {t(SIGNUP_SOURCE_LABELS[source])}
                      </Label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormDescription>{t(SIGNUP_SOURCE_HINT)}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" size="lg" className="w-full">
            {t("onboarding.continue")}
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
