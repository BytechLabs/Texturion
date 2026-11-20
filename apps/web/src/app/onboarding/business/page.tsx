"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isLocale, resolveLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SimpleSelect } from "@/components/ui/simple-select";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useT } from "@/i18n/provider";
import type { Translate } from "@/i18n/provider";
import { trackOnboardingStepCompleted } from "@/lib/analytics/events";
import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/error";
import { useSaveOnboardingRegistration } from "@/lib/api/onboarding";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

import { regionNames } from "../area-codes";
import { normalizeNanpPhone, normalizeWebsite } from "../normalize";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";
import { TCR_VERTICALS, verticalOptions } from "../verticals";

/**
 * Collects the business details needed for carrier registration after checkout.
 */

const EIN_RE = /^[0-9A-Za-z][0-9A-Za-z-]{7,14}$/;
const CONTACT_PHONE_RE = /^\+?[0-9()\-. ]{10,20}$/;

function buildSchema(country: "US" | "CA", t: Translate) {
  const einName = country === "US" ? "EIN" : "Business Number";
  return z
    .object({
      hasEin: z.enum(["yes", "no"]),
      companyName: z.string().trim().max(255),
      ein: z.string().trim(),
      firstName: z.string().trim().max(100),
      lastName: z.string().trim().max(100),
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
  const saveRegistration = useSaveOnboardingRegistration();
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [customerLocale, setCustomerLocale] = useState<Locale | null>(null);
  const activeLocale = customerLocale ?? resolveLocale(state.company?.locale, t.locale);

  useEffect(() => {
    document.title = `${t("onboarding.tabBusinessDetails")} · Loonext`;
  }, [t]);

  const country = state.company?.country ?? "US";
  const schema = useMemo(() => buildSchema(country, t), [country, t]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_VALUES,
  });

  const brandRow = state.registration?.brand ?? null;

  // Seed once: saved draft data (resume / fix-and-resubmit) + the owner's
  // account email as the brand contact prefill.
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

  if (state.status === "error") return <StepError onRetry={state.handleRetry} />;
  if (!ready || !state.snapshot || !state.company || !state.companyId) return <StepLoading />;

  const { company, companyId } = state;
  const progress = stepProgress("business", state.snapshot);
  const hasEin = form.watch("hasEin");
  const einName =
    country === "US" ? t("onboarding.einNameUs") : t("onboarding.einNameCa");
  const regions = regionNames(country, t.locale);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const soleProp = values.hasEin === "no";
    const website = normalizeWebsite(values.website);

    const brand: Record<string, unknown> = {
      displayName: company.name,
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
      if (customerLocale && customerLocale !== company.locale) {
        await apiFetch("/v1/company", {
          method: "PATCH",
          companyId,
          body: { locale: customerLocale },
        });
      }
      await saveRegistration.mutateAsync({ companyId, brand });
      trackOnboardingStepCompleted("business");
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : t("onboarding.genericError"),
      );
    }
  }

  const saving = form.formState.isSubmitting;

  return (
    <StepShell
      step="business"
      index={progress.index}
      total={progress.total}
      title={t("onboarding.businessTitle")}
      subtitle={t("onboarding.businessSubtitle")}
    >
      <Form {...form}>
        <form
          onSubmit={(event) => { void form.handleSubmit(onSubmit)(event); }}
          className="space-y-6"
          noValidate
        >
          <div className="space-y-2">
            <label htmlFor="customer-language" className="text-sm font-medium">
              {t("onboarding.customerLanguage")}
            </label>
            <SimpleSelect
              id="customer-language"
              value={activeLocale}
              onValueChange={(value) => {
                if (isLocale(value)) setCustomerLocale(value);
              }}
              options={[
                { value: "fr-CA", label: "Français" },
                { value: "en", label: "English" },
              ]}
            />
          </div>
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
                <SegmentedControl
                  value={field.value}
                  onChange={(value) => field.onChange(value)}
                  fill
                  ariaLabel={t("onboarding.hasEinLabel", {
                    idName:
                      country === "US"
                        ? t("onboarding.einNameUs")
                        : t("onboarding.einQuestionCa"),
                  })}
                  options={[
                    { value: "yes", label: t("onboarding.yes") },
                    { value: "no", label: t("onboarding.no") },
                  ]}
                />
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
                {t("onboarding.solePropDetail")}
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
                        autoComplete="off"
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
                  <FormControl>
                    <SimpleSelect
                      value={field.value}
                      onValueChange={(value) => field.onChange(value)}
                      placeholder={
                        country === "US"
                          ? t("onboarding.stateLabel")
                          : t("onboarding.provinceLabel")
                      }
                      options={Object.entries(regions).map(([code, name]) => ({
                        value: code,
                        label: name,
                      }))}
                    />
                  </FormControl>
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
                <FormControl>
                  <SimpleSelect
                    value={field.value}
                    onValueChange={(value) => field.onChange(value)}
                    options={verticalOptions(t)}
                  />
                </FormControl>
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
