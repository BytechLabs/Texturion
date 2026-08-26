"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT, type Translate } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { useCreateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useSaveOnboardingRegistration } from "@/lib/api/onboarding";
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
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

import { regionNames } from "../area-codes";
import { clearOnboardingDraft } from "../local-draft";
import { normalizeNanpPhone, normalizeWebsite } from "../normalize";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { previousStepHref, stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";
import { TCR_VERTICALS, verticalOptions } from "../verticals";

/**
 * G7 step 3 — business identity. Feeds 10DLC registration:
 * the form writes the brand draft under the canonical Telnyx payload keys
 * (SPEC §4.4 mapping; validated server-side by apps/api/src/telnyx/wizard.ts).
 * The EIN yes/no branch is the standard-vs-sole-proprietor XOR; every field
 * carries a one-line plain-English "why we ask" hint (G7). On the branch that
 * owes registration this screen also creates the company (AUP checkbox →
 * POST /v1/companies) before saving the draft.
 */

// Mirrors the API brand schemas (wizard.ts): EIN/BN 8–15 chars, last-4 SSN/SIN
// exactly 4 digits, contact phone a loose phone shape, mobile a real US/CA
// destination.
const EIN_RE = /^[0-9A-Za-z][0-9A-Za-z-]{7,14}$/;
const CONTACT_PHONE_RE = /^\+?[0-9()\-. ]{10,20}$/;

function buildSchema(country: "US" | "CA", t: Translate) {
  const einName = country === "US" ? "EIN" : "Business Number";
  const sinName = country === "US" ? "SSN" : "SIN";
  return z
    .object({
      hasEin: z.enum(["yes", "no"]),
      companyName: z.string().trim().max(255),
      ein: z.string().trim(),
      firstName: z.string().trim().max(100),
      lastName: z.string().trim().max(100),
      last4: z.string().trim(),
      mobilePhone: z.string().trim(),
      street: z
        .string()
        .trim()
        .min(1, t("onboarding.bizStreetRequired"))
        .max(255),
      city: z.string().trim().min(1, t("onboarding.bizCityRequired")).max(100),
      state: z
        .string()
        .trim()
        .min(
          1,
          country === "US"
            ? t("onboarding.bizStateRequiredUs")
            : t("onboarding.bizStateRequiredCa"),
        ),
      postalCode: z
        .string()
        .trim()
        .min(
          1,
          country === "US"
            ? t("onboarding.bizPostalRequiredUs")
            : t("onboarding.bizPostalRequiredCa"),
        )
        .max(10, t("onboarding.bizPostalTooLong")),
      website: z.string().trim().max(255, t("onboarding.bizWebsiteTooLong")),
      email: z.email(t("onboarding.bizEmailInvalid")).max(320),
      phone: z
        .string()
        .trim()
        .regex(CONTACT_PHONE_RE, t("onboarding.bizPhoneInvalid")),
      vertical: z.enum(TCR_VERTICALS),
    })
    .superRefine((v, ctx) => {
      if (v.hasEin === "yes") {
        if (v.companyName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["companyName"],
            message: t("onboarding.bizLegalNameRequired"),
          });
        }
        if (!EIN_RE.test(v.ein)) {
          ctx.addIssue({
            code: "custom",
            path: ["ein"],
            message: t("onboarding.bizTaxIdRequired", { id: einName }),
          });
        }
        // Website is optional on every path (G7). When present it must look
        // like a URL (checked below); empty is always valid.
      } else {
        if (v.firstName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["firstName"],
            message: t("onboarding.bizFirstNameRequired"),
          });
        }
        if (v.lastName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["lastName"],
            message: t("onboarding.bizLastNameRequired"),
          });
        }
        if (!/^\d{4}$/.test(v.last4)) {
          ctx.addIssue({
            code: "custom",
            path: ["last4"],
            message: t("onboarding.bizLast4Required", { id: sinName }),
          });
        }
        if (normalizeNanpPhone(v.mobilePhone) === null) {
          ctx.addIssue({
            code: "custom",
            path: ["mobilePhone"],
            message: t("onboarding.bizMobileInvalid"),
          });
        }
      }
      if (
        v.website !== "" &&
        !z.url().safeParse(normalizeWebsite(v.website)).success
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["website"],
          message: t("onboarding.bizWebsiteInvalid"),
        });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const EMPTY_VALUES: FormValues = {
  hasEin: "yes",
  companyName: "",
  ein: "",
  firstName: "",
  lastName: "",
  last4: "",
  mobilePhone: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  website: "",
  email: "",
  phone: "",
  vertical: "PROFESSIONAL",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function BusinessIdentityPage() {
  const t = useT();
  const { state, ready } = useWizardStepGuard("business");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();
  const saveRegistration = useSaveOnboardingRegistration();
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const country: "US" | "CA" =
    state.company?.country ?? state.draft.country ?? "US";
  const schema = useMemo(() => buildSchema(country, t), [country, t]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_VALUES,
  });

  const brandRow = state.registration?.brand ?? null;
  const brandLocked =
    brandRow !== null &&
    brandRow.status !== "draft" &&
    brandRow.status !== "rejected";

  // Seed once: saved draft data (resume / fix-and-resubmit) + the owner's
  // account email as the brand contact prefill (SPEC §4.1 step 3).
  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    void (async () => {
      const data = brandRow?.data ?? {};
      const sole = brandRow?.sole_proprietor === true && "firstName" in data;
      let email = asString(data.email);
      if (email === "") {
        const { data: auth } = await getSupabaseBrowser().auth.getUser();
        email = auth.user?.email ?? "";
      }
      // The form is interactive during the getUser() round-trip (~50-300ms); if
      // the user already started typing, don't wipe their input with the seed
      // reset (mirrors the name step's pristine guard).
      if (form.formState.isDirty) return;
      form.reset({
        ...EMPTY_VALUES,
        hasEin: sole ? "no" : "yes",
        companyName: sole ? "" : asString(data.companyName),
        ein: sole ? "" : asString(data.ein),
        firstName: asString(data.firstName),
        lastName: asString(data.lastName),
        last4: sole ? asString(data.ein) : "",
        mobilePhone: asString(data.mobilePhone),
        street: asString(data.street),
        city: asString(data.city),
        state: asString(data.state),
        postalCode: asString(data.postalCode),
        website: asString(data.website),
        email,
        phone: asString(data.phone),
        vertical: TCR_VERTICALS.includes(data.vertical as never)
          ? (data.vertical as FormValues["vertical"])
          : "PROFESSIONAL",
      });
    })();
  }, [ready, seeded, brandRow, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("business", state.snapshot);
  const hasEin = form.watch("hasEin");
  const einName =
    country === "US" ? t("onboarding.einNameUs") : t("onboarding.einNameCa");
  const sinName =
    country === "US" ? t("onboarding.sinNameUs") : t("onboarding.sinNameCa");
  const regions = regionNames(country, t.locale);

  // Already submitted to carriers → nothing to edit here (409 server-side).
  if (brandLocked) {
    return (
      <StepShell
        backHref={previousStepHref("business", state.snapshot) ?? undefined}
        index={progress.index}
        total={progress.total}
        title={t("onboarding.businessTitle")}
      >
        <div className="space-y-6">
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {t("onboarding.businessLocked")}
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/onboarding/texting")}
          >
            {t("onboarding.continue")}
          </Button>
        </div>
      </StepShell>
    );
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const soleProp = values.hasEin === "no";
    const website = normalizeWebsite(values.website);
    const displayName =
      state.company?.name ?? state.draft.name?.trim() ?? "";

    const brand: Record<string, unknown> = {
      displayName,
      email: values.email,
      phone: values.phone,
      vertical: values.vertical,
      street: values.street,
      city: values.city,
      state: values.state,
      postalCode: values.postalCode,
      country,
      ...(soleProp
        ? {
            firstName: values.firstName,
            lastName: values.lastName,
            ein: values.last4,
            mobilePhone: normalizeNanpPhone(values.mobilePhone),
            ...(website ? { website } : {}),
          }
        : {
            companyName: values.companyName,
            ein: values.ein,
            // Website is optional on the EIN path too (G7); omit when blank so
            // the strict API schema treats it as absent, not empty.
            ...(website ? { website } : {}),
          }),
    };

    try {
      let companyId = state.companyId;
      if (state.company === null) {
        // D15: the creating browser's timezone rides along silently.
        const timezone = browserTimezone();
        const company = await createCompany.mutateAsync({
          name: state.draft.name?.trim() ?? "",
          country,
          requested_area_code: state.draft.areaCode ?? "",
          // Choose-your-number: carry the onboarding pick through to the order.
          ...(state.draft.chosenNumber
            ? { chosen_number_e164: state.draft.chosenNumber }
            : {}),
          ...(country === "CA" ? { us_texting_enabled: true } : {}),
          ...(timezone ? { timezone } : {}),
          // #370: the crew size answered back on the name step.
          ...(state.draft.crewSize ? { crew_size: state.draft.crewSize } : {}),
          // #288: and how they say they heard about us.
          ...(state.draft.signupSource
            ? { signup_source: state.draft.signupSource }
            : {}),
          // #501: the link this signup arrived through, if it arrived through one.
          ...referralCodeForCreate(),
          // #296: which marketing page started this, if we recorded one.
          ...firstTouchForCreate(),
        });
        companyId = company.id;
        writeCompanyCookie(company.id);
        clearReferralCode();
        clearFirstTouch();
      }
      if (!companyId) throw new Error("no active company after create");
      await saveRegistration.mutateAsync({ companyId, brand });
      if (state.company === null) {
        // The next step's guard resolves the company through GET /v1/me —
        // wait for the new membership to be visible before navigating.
        await queryClient.invalidateQueries({ queryKey: keys.me });
        clearOnboardingDraft();
      }
      trackOnboardingStepCompleted("business");
      router.push("/onboarding/texting");
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : t("onboarding.genericError"),
      );
    }
  }

  const saving = createCompany.isPending || saveRegistration.isPending;

  return (
    <StepShell
      backHref={previousStepHref("business", state.snapshot) ?? undefined}
      index={progress.index}
      total={progress.total}
      title={t("onboarding.businessTitle")}
      subtitle={t("onboarding.businessSubtitle")}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="hasEin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("onboarding.hasEinLabel", {
                    idName:
                      country === "US"
                        ? t("onboarding.einNameUs")
                        : t("onboarding.einQuestionCa"),
                  })}
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-2 gap-3"
                  >
                    {(
                      [
                        ["yes", t("onboarding.yes")],
                        ["no", t("onboarding.no")],
                      ] as const
                    ).map(([value, label]) => (
                      <Label
                        key={value}
                        className={cn(
                          "flex h-11 cursor-pointer items-center gap-3 rounded-lg border px-4 text-sm font-medium transition-colors duration-150 ease-out",
                          field.value === value
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-accent",
                        )}
                      >
                        <RadioGroupItem value={value} />
                        {label}
                      </Label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormDescription>
                  {country === "US"
                    ? t("onboarding.einHintUs")
                    : t("onboarding.einHintCa")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {hasEin === "no" ? (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <p className="text-sm">{t("onboarding.solePropLead")}</p>
              <p className="text-[13px] text-muted-foreground">
                {t("onboarding.solePropDetail", { idName: sinName })}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("onboarding.legalFirstName")}</FormLabel>
                      <FormControl>
                        <Input autoComplete="given-name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("onboarding.legalLastName")}</FormLabel>
                      <FormControl>
                        <Input autoComplete="family-name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="last4"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("onboarding.last4Label", { idName: sinName })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="1234"
                        className="tabular-nums"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("onboarding.last4Hint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mobilePhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.mobileLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        autoComplete="tel"
                        placeholder="(416) 555-0182"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("onboarding.mobileHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ) : (
            <>
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.legalBusinessName")}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="organization"
                        placeholder={
                          country === "US"
                            ? t("onboarding.legalBusinessPlaceholderUs")
                            : t("onboarding.legalBusinessPlaceholderCa")
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("onboarding.legalBusinessNameHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ein"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{einName}</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        placeholder={country === "US" ? "12-3456789" : "123456789"}
                        className="tabular-nums"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("onboarding.einHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          <FormField
            control={form.control}
            name="street"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.streetLabel")}</FormLabel>
                <FormControl>
                  <Input autoComplete="street-address" {...field} />
                </FormControl>
                <FormDescription>
                  {t("onboarding.streetHint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("onboarding.cityLabel")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="address-level2" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {country === "US"
                      ? t("onboarding.stateLabel")
                      : t("onboarding.provinceLabel")}
                  </FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            country === "US"
                              ? t("onboarding.stateLabel")
                              : t("onboarding.provinceLabel")
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(regions).map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="postalCode"
              render={({ field }) => (
                <FormItem className="col-span-2 sm:col-span-1">
                  <FormLabel>
                    {country === "US"
                      ? t("onboarding.zipLabel")
                      : t("onboarding.postalLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input autoComplete="postal-code" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.websiteLabel")}</FormLabel>
                <FormControl>
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="mikesplumbing.com"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t("onboarding.websiteHint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("onboarding.contactEmailLabel")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("onboarding.contactEmailHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("onboarding.contactPhoneLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder="(416) 555-0182"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("onboarding.contactPhoneHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="vertical"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.verticalLabel")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {verticalOptions(t).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t("onboarding.verticalHint")}
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

          <Button type="submit" size="lg" className="w-full" disabled={saving}>
            {saving ? t("common.saving") : t("onboarding.saveAndContinue")}
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
