"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCreateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useSaveOnboardingRegistration } from "@/lib/api/onboarding";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { browserTimezone } from "@/lib/format/time";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

import { CA_REGION_NAMES, US_REGION_NAMES } from "../area-codes";
import { clearOnboardingDraft } from "../local-draft";
import { normalizeNanpPhone, normalizeWebsite } from "../normalize";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";
import { TCR_VERTICALS, VERTICAL_OPTIONS } from "../verticals";

/**
 * G7 step 3 — business identity. Feeds the SMS footer + 10DLC registration:
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

function buildSchema(country: "US" | "CA", needsAup: boolean) {
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
      street: z.string().trim().min(1, "Enter your street address.").max(255),
      city: z.string().trim().min(1, "Enter your city.").max(100),
      state: z
        .string()
        .trim()
        .min(1, country === "US" ? "Pick your state." : "Pick your province."),
      postalCode: z
        .string()
        .trim()
        .min(1, country === "US" ? "Enter your ZIP code." : "Enter your postal code.")
        .max(10, "Keep it under 10 characters."),
      website: z.string().trim().max(255, "Keep it under 255 characters."),
      email: z.email("Enter a real email address.").max(320),
      phone: z
        .string()
        .trim()
        .regex(CONTACT_PHONE_RE, "Enter a phone number carriers can reach you at."),
      vertical: z.enum(TCR_VERTICALS),
      aup: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.hasEin === "yes") {
        if (v.companyName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["companyName"],
            message: "Enter your legal business name.",
          });
        }
        if (!EIN_RE.test(v.ein)) {
          ctx.addIssue({
            code: "custom",
            path: ["ein"],
            message: `Enter your ${einName} (numbers and dashes are fine).`,
          });
        }
        // Website is optional on every path (G7). When present it must look
        // like a URL (checked below); empty is always valid.
      } else {
        if (v.firstName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["firstName"],
            message: "Enter your legal first name.",
          });
        }
        if (v.lastName === "") {
          ctx.addIssue({
            code: "custom",
            path: ["lastName"],
            message: "Enter your legal last name.",
          });
        }
        if (!/^\d{4}$/.test(v.last4)) {
          ctx.addIssue({
            code: "custom",
            path: ["last4"],
            message: `Enter the last 4 digits of your ${sinName}.`,
          });
        }
        if (normalizeNanpPhone(v.mobilePhone) === null) {
          ctx.addIssue({
            code: "custom",
            path: ["mobilePhone"],
            message: "Enter a US or Canadian mobile number.",
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
          message: "That doesn't look like a web address.",
        });
      }
      if (needsAup && v.aup !== true) {
        ctx.addIssue({
          code: "custom",
          path: ["aup"],
          message: "You need to agree before continuing.",
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
  aup: false,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function BusinessIdentityPage() {
  const { state, ready } = useWizardStepGuard("business");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();
  const saveRegistration = useSaveOnboardingRegistration();
  const [formError, setFormError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const country: "US" | "CA" =
    state.company?.country ?? state.draft.country ?? "US";
  const needsAup = state.company === null;
  const schema = useMemo(
    () => buildSchema(country, needsAup),
    [country, needsAup],
  );

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
        aup: false,
      });
    })();
  }, [ready, seeded, brandRow, form]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot) return <StepLoading />;

  const progress = stepProgress("business", state.snapshot);
  const hasEin = form.watch("hasEin");
  const einName = country === "US" ? "EIN" : "Business Number";
  const sinName = country === "US" ? "SSN" : "SIN";
  const regions = country === "US" ? US_REGION_NAMES : CA_REGION_NAMES;

  // Already submitted to carriers → nothing to edit here (409 server-side).
  if (brandLocked) {
    return (
      <StepShell
        backHref="/onboarding/number"
        index={progress.index}
        total={progress.total}
        title="Tell us about your business"
      >
        <div className="space-y-6">
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Your business details were already submitted to carriers — nothing
            more to do on this step.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/onboarding/texting")}
          >
            Continue
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
          ...(country === "CA" ? { us_texting_enabled: true } : {}),
          ...(timezone ? { timezone } : {}),
          aup_accepted: true,
        });
        companyId = company.id;
        writeCompanyCookie(company.id);
      }
      if (!companyId) throw new Error("no active company after create");
      await saveRegistration.mutateAsync({ companyId, brand });
      if (state.company === null) {
        // The next step's guard resolves the company through GET /v1/me —
        // wait for the new membership to be visible before navigating.
        await queryClient.invalidateQueries({ queryKey: keys.me });
        clearOnboardingDraft();
      }
      router.push("/onboarding/texting");
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong on our end. Try again in a moment.",
      );
    }
  }

  const saving = createCompany.isPending || saveRegistration.isPending;

  return (
    <StepShell
      backHref="/onboarding/number"
      index={progress.index}
      total={progress.total}
      title="Tell us about your business"
      subtitle="Carriers require this before a business can text customers. We file everything for you — it takes about 2 minutes."
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
                  Do you have an {country === "US" ? "EIN" : "EIN / Business Number"}?
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-2 gap-3"
                  >
                    {(
                      [
                        ["yes", "Yes"],
                        ["no", "No"],
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
                    ? "An EIN is the 9-digit tax ID the IRS gave your business."
                    : "The 9-digit number the CRA gave your business."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {hasEin === "no" ? (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <p className="text-sm">
                No problem — we&apos;ll register you as a sole proprietor.
              </p>
              <p className="text-[13px] text-muted-foreground">
                Same texting features. Carriers verify you with the last 4
                digits of your {sinName} and a code texted to your phone. One
                thing to know: sole proprietor registrations are limited to
                one phone number.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Legal first name</FormLabel>
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
                      <FormLabel>Legal last name</FormLabel>
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
                    <FormLabel>Last 4 digits of your {sinName}</FormLabel>
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
                      Carriers use it to confirm you&apos;re you. We only ever
                      ask for — and store — the last 4.
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
                    <FormLabel>Your mobile number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        autoComplete="tel"
                        placeholder="(416) 555-0182"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      We&apos;ll text a 6-digit verification code to this
                      number after payment.
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
                    <FormLabel>Legal business name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="organization"
                        placeholder={
                          country === "US"
                            ? "Mike's Plumbing LLC"
                            : "Mike's Plumbing Inc."
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Carriers check this against government business records.
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
                      Proves your business to carriers. It&apos;s never shown
                      to customers.
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
                <FormLabel>Street address</FormLabel>
                <FormControl>
                  <Input autoComplete="street-address" {...field} />
                </FormControl>
                <FormDescription>
                  Carriers require a physical address on file — it&apos;s
                  never shown to customers.
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
                  <FormLabel>City</FormLabel>
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
                  <FormLabel>{country === "US" ? "State" : "Province"}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={country === "US" ? "State" : "Province"}
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
                    {country === "US" ? "ZIP code" : "Postal code"}
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
                <FormLabel>Website (optional)</FormLabel>
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
                  Carriers look for a real web presence — a Facebook or Google
                  Business page counts.
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
                  <FormLabel>Contact email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormDescription>
                    Where registration updates land.
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
                  <FormLabel>Contact phone</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder="(416) 555-0182"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A number carriers can reach you at — your cell is fine.
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
                <FormLabel>What kind of work do you do?</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {VERTICAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Tells carriers the kind of texts you&apos;ll send.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {needsAup ? (
            <FormField
              control={form.control}
              name="aup"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                        className="mt-0.5"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal leading-snug text-muted-foreground">
                      I&apos;ll only text customers who asked to hear from us
                      — no spam, no purchased lists.
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </Form>
    </StepShell>
  );
}
