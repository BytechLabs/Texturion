"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { useT, type Translate } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { ApiError } from "@/lib/api/error";
import { useSaveOnboardingRegistration } from "@/lib/api/onboarding";

import { StepError, StepLoading, StepShell } from "../step-shell";
import { previousStepHref, stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

/**
 * G7/SPEC §4.1 step 3 (campaign half): the opt-in flow description and two
 * sample messages carriers review. Pre-filled with truthful, editable
 * defaults — the opt-in description is the SPEC's verbatim default; the
 * samples come from ICP templates with the real business name. Saved under
 * the canonical Telnyx keys (messageFlow, sample1, sample2 — SPEC §4.4).
 */

/*
 * TCR floors mirrored from apps/api/src/telnyx/wizard.ts campaignDraftSchema.
 *
 * A factory rather than a module-level constant: every message is read under
 * the field by the person filling it in, so it is copy and belongs in the
 * catalogue.
 */
function buildSchema(t: Translate) {
  return z.object({
    messageFlow: z
      .string()
      .trim()
      .min(40, t("onboarding.textingFlowTooShort"))
      .max(2048, t("onboarding.textingFlowTooLong")),
    sample1: z
      .string()
      .trim()
      .min(20, t("onboarding.textingSampleTooShort"))
      .max(1024, t("onboarding.textingSampleTooLong")),
    sample2: z
      .string()
      .trim()
      .min(20, t("onboarding.textingSampleTooShort"))
      .max(1024, t("onboarding.textingSampleTooLong")),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/**
 * SPEC §4.1 step 3 — the pre-filled truthful default, verbatim.
 *
 * #228: THIS ONE STAYS ENGLISH, and so do the sample texts below it.
 *
 * They are not UI copy. They are the FIELD VALUES this form submits to The
 * Campaign Registry, where a US carrier's reviewer reads them to decide whether
 * to approve the brand. A French default here would hand that reviewer a
 * submission they cannot assess, and the cost of getting it wrong is a rejected
 * registration rather than an awkward sentence. The labels, hints and floors
 * around the fields are all in the catalogue; what goes IN the fields is the
 * business's own words, seeded in the language the registry reads.
 */
const DEFAULT_MESSAGE_FLOW =
  "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.";

function defaultSamples(businessName: string): Pick<FormValues, "sample1" | "sample2"> {
  const name = businessName.trim() || "our team";
  return {
    sample1: `Hi, it's ${name}. We can fit you in tomorrow between 9 and 11am. Does that still work for you?`,
    sample2: `${name} here. Your quote is ready: $180 for the full job. Reply YES to book it, or text us any questions.`,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function TextingDetailsPage() {
  const t = useT();
  const { state, ready } = useWizardStepGuard("texting");
  const router = useRouter();
  const saveRegistration = useSaveOnboardingRegistration();
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const schema = useMemo(() => buildSchema(t), [t]);
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
        backHref={previousStepHref("texting", state.snapshot) ?? undefined}
        index={progress.index}
        total={progress.total}
        title={t("onboarding.textingTitle")}
      >
        <div className="space-y-6">
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {t("onboarding.textingLocked")}
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/onboarding/plan")}
          >
            {t("onboarding.continue")}
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
      trackOnboardingStepCompleted("texting");
      router.push("/onboarding/plan");
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : t("onboarding.genericError"),
      );
    }
  }

  return (
    <StepShell
      backHref={previousStepHref("texting", state.snapshot) ?? undefined}
      index={progress.index}
      total={progress.total}
      title={t("onboarding.textingTitle")}
      subtitle={t("onboarding.textingSubtitle")}
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
                <FormLabel>{t("onboarding.messageFlowLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormDescription>
                  {t("onboarding.messageFlowHint")}
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
                <FormLabel>{t("onboarding.sample1Label")}</FormLabel>
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
                <FormLabel>{t("onboarding.sample2Label")}</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormDescription>
                  {t("onboarding.sample2Hint")}
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
            {saveRegistration.isPending
              ? t("common.saving")
              : t("onboarding.saveAndContinue")}
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
