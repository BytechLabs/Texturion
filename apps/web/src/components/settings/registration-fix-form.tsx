"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useSaveRegistration,
  useSubmitRegistration,
} from "@/lib/api/registration";
import type { Country, RegistrationRow } from "@/lib/api/types";
import { normalizeNanpPhone } from "@/lib/contacts/csv-import";
import { normalizeWebsite } from "@/app/onboarding/normalize";

/**
 * The §4.4 fix-and-resubmit form (G8 Numbers): edits the wizard data of
 * draft/rejected brand and/or campaign rows (PUT /v1/registration) and
 * resubmits (POST /v1/registration/submit). Field names and constraints
 * mirror the API's canonical wizard schemas (apps/api/src/telnyx/wizard.ts)
 * — the server re-validates everything.
 */

/** TCR verticals — mirror of the API's list (apps/api/src/telnyx/wizard.ts). */
const TCR_VERTICALS = [
  "AGRICULTURE",
  "COMMUNICATION",
  "CONSTRUCTION",
  "EDUCATION",
  "ENERGY",
  "ENTERTAINMENT",
  "FINANCIAL",
  "GAMBLING",
  "GOVERNMENT",
  "HEALTHCARE",
  "HOSPITALITY",
  "HUMAN_RESOURCES",
  "INSURANCE",
  "LEGAL",
  "MANUFACTURING",
  "NGO",
  "POLITICAL",
  "POSTAL",
  "PROFESSIONAL",
  "REAL_ESTATE",
  "RETAIL",
  "TECHNOLOGY",
  "TRANSPORTATION",
] as const;

/**
 * TCR's taxonomy, in the reader's language.
 *
 * A map rather than the old title-casing of the token, because "REAL_ESTATE"
 * title-cased is English, and a French reader picking their trade out of a list
 * is the one person on this form who cannot be asked to guess.
 */
const VERTICAL_LABELS: Record<(typeof TCR_VERTICALS)[number], MessageKey> = {
  AGRICULTURE: "settingsMore.verticalAgriculture",
  COMMUNICATION: "settingsMore.verticalCommunication",
  CONSTRUCTION: "settingsMore.verticalConstruction",
  EDUCATION: "settingsMore.verticalEducation",
  ENERGY: "settingsMore.verticalEnergy",
  ENTERTAINMENT: "settingsMore.verticalEntertainment",
  FINANCIAL: "settingsMore.verticalFinancial",
  GAMBLING: "settingsMore.verticalGambling",
  GOVERNMENT: "settingsMore.verticalGovernment",
  HEALTHCARE: "settingsMore.verticalHealthcare",
  HOSPITALITY: "settingsMore.verticalHospitality",
  HUMAN_RESOURCES: "settingsMore.verticalHumanResources",
  INSURANCE: "settingsMore.verticalInsurance",
  LEGAL: "settingsMore.verticalLegal",
  MANUFACTURING: "settingsMore.verticalManufacturing",
  NGO: "settingsMore.verticalNgo",
  POLITICAL: "settingsMore.verticalPolitical",
  POSTAL: "settingsMore.verticalPostal",
  PROFESSIONAL: "settingsMore.verticalProfessional",
  REAL_ESTATE: "settingsMore.verticalRealEstate",
  RETAIL: "settingsMore.verticalRetail",
  TECHNOLOGY: "settingsMore.verticalTechnology",
  TRANSPORTATION: "settingsMore.verticalTransportation",
};

interface FixFormValues {
  displayName: string;
  email: string;
  phone: string;
  vertical: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  companyName: string;
  ein: string;
  website: string;
  firstName: string;
  lastName: string;
  mobilePhone: string;
  messageFlow: string;
  sample1: string;
  sample2: string;
}

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * A website is valid when blank (optional on EVERY brand path — matches the API
 * + onboarding) or resolves to a real URL after normalization (a bare domain
 * like "mikesplumbing.com" is accepted, exactly as onboarding accepts it).
 */
function isValidOptionalWebsite(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || z.url().safeParse(normalizeWebsite(trimmed)).success;
}

const CONTACT_PHONE_RE = /^\+?[0-9()\-. ]{10,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FixFormProps {
  brand: RegistrationRow | null;
  campaign: RegistrationRow | null;
  country: Country;
  /** Button label — the first-submission key for a draft recovery. */
  submitLabel?: MessageKey;
  /** Called after a successful resubmission. */
  onSubmitted?: () => void;
}

function editable(row: RegistrationRow | null): boolean {
  return row !== null && (row.status === "draft" || row.status === "rejected");
}

export function RegistrationFixForm({
  brand,
  campaign,
  country,
  submitLabel = "settingsMore.regResubmitAction",
  onSubmitted,
}: FixFormProps) {
  const t = useT();
  const editBrand = editable(brand);
  const editCampaign = editable(campaign);
  const soleProp = brand?.sole_proprietor ?? false;

  const save = useSaveRegistration();
  const submit = useSubmitRegistration();
  const [serverError, setServerError] = useState<string | null>(null);

  const schema = useMemo(() => {
    const base = z.object({
      displayName: z.string(),
      email: z.string(),
      phone: z.string(),
      vertical: z.string(),
      street: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      companyName: z.string(),
      ein: z.string(),
      website: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      mobilePhone: z.string(),
      messageFlow: z.string(),
      sample1: z.string(),
      sample2: z.string(),
    });
    return base.superRefine((v, ctx) => {
      const need = (
        key: keyof FixFormValues,
        max: number,
        label: MessageKey,
      ) => {
        const value = v[key].trim();
        if (value === "") {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: t("settingsMore.regEnter", { what: t(label) }),
          });
        } else if (value.length > max) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: t("settingsMore.regTooLong", { max }),
          });
        }
      };

      if (editBrand) {
        need("displayName", 255, "settingsMore.regFieldDisplayName");
        if (!EMAIL_RE.test(v.email.trim()) || v.email.trim().length > 320) {
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: t("settingsMore.regEmailInvalid"),
          });
        }
        if (!CONTACT_PHONE_RE.test(v.phone.trim())) {
          ctx.addIssue({
            code: "custom",
            path: ["phone"],
            message: t("settingsMore.regPhoneInvalid"),
          });
        }
        need("street", 255, "settingsMore.regFieldStreet");
        need("city", 100, "settingsMore.regFieldCity");
        need(
          "state",
          20,
          country === "US"
            ? "settingsMore.regFieldState"
            : "settingsMore.regFieldProvince",
        );
        need(
          "postalCode",
          10,
          country === "US"
            ? "settingsMore.regFieldZip"
            : "settingsMore.regFieldPostal",
        );

        if (soleProp) {
          need("firstName", 100, "settingsMore.regFieldFirstName");
          need("lastName", 100, "settingsMore.regFieldLastName");
          if (!/^\d{4}$/.test(v.ein.trim())) {
            ctx.addIssue({
              code: "custom",
              path: ["ein"],
              message:
                country === "US"
                  ? t("settingsMore.regSsnLast4")
                  : t("settingsMore.regSinLast4"),
            });
          }
          if (normalizeNanpPhone(v.mobilePhone) === null) {
            ctx.addIssue({
              code: "custom",
              path: ["mobilePhone"],
              message: t("settingsMore.regMobileInvalid"),
            });
          }
          if (!isValidOptionalWebsite(v.website)) {
            ctx.addIssue({
              code: "custom",
              path: ["website"],
              message: t("settingsMore.regWebsiteInvalid"),
            });
          }
        } else {
          need("companyName", 255, "settingsMore.regFieldCompanyName");
          if (!/^[0-9A-Za-z][0-9A-Za-z-]{7,14}$/.test(v.ein.trim())) {
            ctx.addIssue({
              code: "custom",
              path: ["ein"],
              message:
                country === "US"
                  ? t("settingsMore.regEinInvalid")
                  : t("settingsMore.regCraInvalid"),
            });
          }
          // Website is OPTIONAL on the EIN path too (matches the API +
          // onboarding); only validate a non-blank value, and accept a bare
          // domain (normalized). Requiring it here blocked resubmission for a
          // standard brand that legitimately has no website.
          if (!isValidOptionalWebsite(v.website)) {
            ctx.addIssue({
              code: "custom",
              path: ["website"],
              message: t("settingsMore.regWebsiteInvalid"),
            });
          }
        }
      }

      if (editCampaign) {
        if (v.messageFlow.trim().length < 40) {
          ctx.addIssue({
            code: "custom",
            path: ["messageFlow"],
            message: t("settingsMore.regMessageFlowShort"),
          });
        } else if (v.messageFlow.trim().length > 2048) {
          ctx.addIssue({
            code: "custom",
            path: ["messageFlow"],
            message: t("settingsMore.regMessageFlowLong"),
          });
        }
        for (const key of ["sample1", "sample2"] as const) {
          const value = v[key].trim();
          if (value.length < 20) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: t("settingsMore.regSampleShort"),
            });
          } else if (value.length > 1024) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: t("settingsMore.regSampleLong"),
            });
          }
        }
      }
    });
    // `t` is a dependency so a language change rebuilds these messages.
  }, [editBrand, editCampaign, soleProp, country, t]);

  const form = useForm<FixFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: str(brand?.data, "displayName"),
      email: str(brand?.data, "email"),
      phone: str(brand?.data, "phone"),
      vertical: str(brand?.data, "vertical") || "PROFESSIONAL",
      street: str(brand?.data, "street"),
      city: str(brand?.data, "city"),
      state: str(brand?.data, "state"),
      postalCode: str(brand?.data, "postalCode"),
      companyName: str(brand?.data, "companyName"),
      ein: str(brand?.data, "ein"),
      website: str(brand?.data, "website"),
      firstName: str(brand?.data, "firstName"),
      lastName: str(brand?.data, "lastName"),
      mobilePhone: str(brand?.data, "mobilePhone"),
      messageFlow: str(campaign?.data, "messageFlow"),
      sample1: str(campaign?.data, "sample1"),
      sample2: str(campaign?.data, "sample2"),
    },
  });

  async function onSubmit(values: FixFormValues) {
    setServerError(null);
    try {
      const payload: {
        brand?: Record<string, unknown>;
        campaign?: Record<string, unknown>;
      } = {};
      if (editBrand) {
        const common = {
          displayName: values.displayName.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          vertical: values.vertical,
          street: values.street.trim(),
          city: values.city.trim(),
          state: values.state.trim(),
          postalCode: values.postalCode.trim(),
          country,
        };
        payload.brand = soleProp
          ? {
              ...common,
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              ein: values.ein.trim(),
              mobilePhone: normalizeNanpPhone(values.mobilePhone) as string,
              ...(values.website.trim() !== ""
                ? { website: normalizeWebsite(values.website) }
                : {}),
            }
          : {
              ...common,
              companyName: values.companyName.trim(),
              ein: values.ein.trim(),
              // Optional + normalized (bare domain → https://…); omit when blank
              // so the API's optional website accepts it.
              ...(values.website.trim() !== ""
                ? { website: normalizeWebsite(values.website) }
                : {}),
            };
      }
      if (editCampaign) {
        payload.campaign = {
          messageFlow: values.messageFlow.trim(),
          sample1: values.sample1.trim(),
          sample2: values.sample2.trim(),
        };
      }
      if (payload.brand || payload.campaign) {
        await save.mutateAsync(payload);
      }
      await submit.mutateAsync();
      toast.success(t("settingsMore.regSubmitted"));
      onSubmitted?.();
    } catch (cause) {
      setServerError(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.regResubmitFailed"),
      );
    }
  }

  const busy = form.formState.isSubmitting || save.isPending || submit.isPending;

  return (
    <Form {...form}>
      <form
        // method="post" so a pre-hydration native submit keeps sensitive
        // registration data (EIN, SSN last-4) in the body, never the URL.
        method="post"
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        {editBrand && (
          <div className="space-y-4">
            {soleProp ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("settingsMore.regFirstNameLabel")}
                        </FormLabel>
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
                        <FormLabel>
                          {t("settingsMore.regLastNameLabel")}
                        </FormLabel>
                        <FormControl>
                          <Input autoComplete="family-name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="ein"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {country === "US"
                            ? t("settingsMore.regSsnLabel")
                            : t("settingsMore.regSinLabel")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            maxLength={4}
                            autoComplete="off"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settingsMore.regSsnHelp")}
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
                        <FormLabel>
                          {t("settingsMore.regMobileLabel")}
                        </FormLabel>
                        <FormControl>
                          <Input inputMode="tel" autoComplete="tel" {...field} />
                        </FormControl>
                        <FormDescription>
                          {t("settingsMore.regMobileHelp")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("settingsMore.regLegalNameLabel")}
                      </FormLabel>
                      <FormControl>
                        <Input autoComplete="organization" {...field} />
                      </FormControl>
                      <FormDescription>
                        {country === "US"
                          ? t("settingsMore.regLegalNameHelpUs")
                          : t("settingsMore.regLegalNameHelpCa")}
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
                      <FormLabel>
                        {country === "US"
                          ? t("settingsMore.regEinLabel")
                          : t("settingsMore.regBusinessNumberLabel")}
                      </FormLabel>
                      <FormControl>
                        <Input autoComplete="off" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settingsMore.regDisplayNameLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settingsMore.regEmailLabel")}</FormLabel>
                    <FormControl>
                      <Input type="email" inputMode="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settingsMore.regPhoneLabel")}</FormLabel>
                    <FormControl>
                      <Input inputMode="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="street"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settingsMore.regStreetLabel")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="street-address" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settingsMore.portFixCity")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                        ? t("settingsMore.portFixState")
                        : t("settingsMore.portFixProvince")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="postalCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {country === "US"
                        ? t("settingsMore.portFixZip")
                        : t("settingsMore.portFixPostalCode")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {soleProp
                        ? t("settingsMore.regWebsiteOptionalLabel")
                        : t("settingsMore.regWebsiteLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="https://…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vertical"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settingsMore.regVerticalLabel")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TCR_VERTICALS.map((vertical) => (
                          <SelectItem key={vertical} value={vertical}>
                            {t(VERTICAL_LABELS[vertical])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}

        {editCampaign && (
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="messageFlow"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settingsMore.regMessageFlowLabel")}
                  </FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("settingsMore.regMessageFlowHelp")}
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
                  <FormLabel>{t("settingsMore.regSample1Label")}</FormLabel>
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
                  <FormLabel>{t("settingsMore.regSample2Label")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {serverError && (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? t("settingsMore.regSubmitting") : t(submitLabel)}
        </Button>
      </form>
    </Form>
  );
}
