"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/error";
import { useSaveOnboardingRegistration } from "@/lib/api/onboarding";

import { StepError, StepLoading, StepShell } from "../step-shell";
import { stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

/**
 * G7/SPEC §4.1 step 3 (campaign half): the opt-in flow description and two
 * sample messages carriers review. Pre-filled with truthful, editable
 * defaults — the opt-in description is the SPEC's verbatim default; the
 * samples come from ICP templates with the real business name. Saved under
 * the canonical Telnyx keys (messageFlow, sample1, sample2 — SPEC §4.4).
 */

// TCR floors mirrored from apps/api/src/telnyx/wizard.ts campaignDraftSchema.
const schema = z.object({
  messageFlow: z
    .string()
    .trim()
    .min(40, "Give carriers at least a sentence or two (40+ characters).")
    .max(2048, "Keep it under 2,048 characters."),
  sample1: z
    .string()
    .trim()
    .min(20, "Make it a realistic text — at least 20 characters.")
    .max(1024, "Keep it under 1,024 characters."),
  sample2: z
    .string()
    .trim()
    .min(20, "Make it a realistic text — at least 20 characters.")
    .max(1024, "Keep it under 1,024 characters."),
});

type FormValues = z.infer<typeof schema>;

/** SPEC §4.1 step 3 — the pre-filled truthful default, verbatim. */
const DEFAULT_MESSAGE_FLOW =
  "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.";

function defaultSamples(businessName: string): Pick<FormValues, "sample1" | "sample2"> {
  const name = businessName.trim() || "our team";
  return {
    sample1: `Hi, it's ${name} — we can fit you in tomorrow between 9 and 11am. Does that still work for you?`,
    sample2: `${name} here. Your quote is ready: $180 for the full job. Reply YES to book it, or text us any questions.`,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function TextingDetailsPage() {
  const { state, ready } = useWizardStepGuard("texting");
  const router = useRouter();
  const saveRegistration = useSaveOnboardingRegistration();
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { messageFlow: "", sample1: "", sample2: "" },
  });

  const campaignRow = state.registration?.campaign ?? null;
  const campaignLocked =
    campaignRow !== null &&
    campaignRow.status !== "draft" &&
    campaignRow.status !== "rejected";

  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    const data = campaignRow?.data ?? {};
    const samples = defaultSamples(state.company?.name ?? "");
    form.reset({
      messageFlow: asString(data.messageFlow) || DEFAULT_MESSAGE_FLOW,
      sample1: asString(data.sample1) || samples.sample1,
      sample2: asString(data.sample2) || samples.sample2,
    });
  }, [ready, seeded, campaignRow, state.company?.name, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("texting", state.snapshot);

  if (campaignLocked) {
    return (
      <StepShell
        backHref="/onboarding/business"
        index={progress.index}
        total={progress.total}
        title="How customers hear from you"
      >
        <div className="space-y-6">
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            These details were already submitted to carriers — nothing more to
            do on this step.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/onboarding/plan")}
          >
            Continue
          </Button>
        </div>
      </StepShell>
    );
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    if (!state.companyId) return;
    try {
      await saveRegistration.mutateAsync({
        companyId: state.companyId,
        campaign: values,
      });
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
      backHref="/onboarding/business"
      index={progress.index}
      total={progress.total}
      title="How customers hear from you"
      subtitle="Carriers review these before approving business texting. We've written honest defaults — edit them if they don't fit."
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="messageFlow"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How do customers say yes to texts?</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormDescription>
                  Plain truth works best — carriers reject marketing-blast
                  language.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sample1"
            render={({ field }) => (
              <FormItem>
                <FormLabel>A text you&apos;d actually send</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sample2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>One more example</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormDescription>
                  Carriers just want to see everyday customer conversations.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={saveRegistration.isPending}
          >
            {saveRegistration.isPending ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
