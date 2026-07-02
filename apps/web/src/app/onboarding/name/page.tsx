"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
});

/**
 * G7 step: company name. Local until POST /v1/companies (the create call
 * needs name + country + area code + AUP together).
 */
export default function CompanyNamePage() {
  const { state, ready } = useWizardStepGuard("name");
  const router = useRouter();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  // Prefill from a saved draft once resume state is in.
  const draftName = state.draft.name ?? "";
  useEffect(() => {
    if (draftName && form.getValues("name") === "") {
      form.reset({ name: draftName });
    }
  }, [draftName, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("name", state.snapshot);

  function onSubmit(values: z.infer<typeof schema>) {
    writeOnboardingDraft({ name: values.name });
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
                  It signs your first text to each customer — you can change it
                  later in Settings.
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
