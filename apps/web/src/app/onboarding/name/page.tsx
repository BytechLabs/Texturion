"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CREW_SIZE_BUCKETS, CREW_SIZE_LABELS } from "@loonext/shared";

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
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { cn } from "@/lib/utils";

import { CREW_FIT_PROMPT, crewFitCopy } from "../crew-copy";
import { writeOnboardingDraft } from "../local-draft";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your company name.")
    .max(200, "Keep it under 200 characters."),
  // #370: optional on purpose. A signup that skips it is a signup we still
  // want, and the column keeps "never asked" distinguishable from "solo".
  crewSize: z.enum(CREW_SIZE_BUCKETS).optional(),
});

/**
 * G7 step: company name. Local until POST /v1/companies (the create call
 * needs name + country + area code + AUP together).
 *
 * #370 adds the crew-size question here rather than anywhere later, for two
 * reasons. It is the only pre-company step with room, so the answer rides the
 * local draft to whichever of the three creation call sites fires (number,
 * business, port) without a second round trip. And it is the cheapest screen in
 * the funnel to add a tap to: one field, and the most whitespace.
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
  const { state, ready } = useWizardStepGuard("name");
  const router = useRouter();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", crewSize: undefined },
  });

  // Prefill from a saved draft once resume state is in.
  const draftName = state.draft.name ?? "";
  const draftCrewSize = state.draft.crewSize;
  useEffect(() => {
    if (draftName && form.getValues("name") === "") {
      form.reset({ name: draftName, crewSize: draftCrewSize });
    }
  }, [draftName, draftCrewSize, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("name", state.snapshot);
  const chosenCrew = form.watch("crewSize");

  function onSubmit(values: z.infer<typeof schema>) {
    writeOnboardingDraft({
      name: values.name,
      ...(values.crewSize ? { crewSize: values.crewSize } : {}),
    });
    trackOnboardingStepCompleted("name");
    router.push("/onboarding/number");
  }

  return (
    <StepShell
      index={progress.index}
      total={progress.total}
      title="What's your company called?"
      subtitle="This is the name your customers see."
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
                <FormLabel>Company name</FormLabel>
                <FormControl>
                  <Input
                    autoFocus
                    autoComplete="organization"
                    placeholder="Mike's Plumbing"
                    className="h-12 text-base"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  It signs your first text to each customer. You can change it
                  later in Settings.
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
                <FormLabel>How many of you are there?</FormLabel>
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
                  {chosenCrew ? crewFitCopy(chosenCrew) : CREW_FIT_PROMPT}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
