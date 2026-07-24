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

function verticalLabel(vertical: string): string {
  const lower = vertical.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

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
  /** Button label — "Submit registration" for a first submission (draft recovery). */
  submitLabel?: string;
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
  submitLabel = "Resubmit registration",
  onSubmitted,
}: FixFormProps) {
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
        label: string,
      ) => {
        const value = v[key].trim();
        if (value === "") {
          ctx.addIssue({ code: "custom", path: [key], message: `Enter ${label}.` });
        } else if (value.length > max) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `Keep it under ${max} characters.`,
          });
        }
      };

      if (editBrand) {
        need("displayName", 255, "the business name customers know");
        if (!EMAIL_RE.test(v.email.trim()) || v.email.trim().length > 320) {
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: "Enter a contact email address.",
          });
        }
        if (!CONTACT_PHONE_RE.test(v.phone.trim())) {
          ctx.addIssue({
            code: "custom",
            path: ["phone"],
            message: "Enter a contact phone number.",
          });
        }
        need("street", 255, "the street address");
        need("city", 100, "the city");
        need("state", 20, country === "US" ? "the state" : "the province");
        need("postalCode", 10, country === "US" ? "the ZIP code" : "the postal code");

        if (soleProp) {
          need("firstName", 100, "your first name");
          need("lastName", 100, "your last name");
          if (!/^\d{4}$/.test(v.ein.trim())) {
            ctx.addIssue({
              code: "custom",
              path: ["ein"],
              message: `Enter the last 4 digits of your ${country === "US" ? "SSN" : "SIN"}.`,
            });
          }
          if (normalizeNanpPhone(v.mobilePhone) === null) {
            ctx.addIssue({
              code: "custom",
              path: ["mobilePhone"],
              message: "Enter a US or Canadian mobile number; it gets the verification text.",
            });
          }
          if (!isValidOptionalWebsite(v.website)) {
            ctx.addIssue({
              code: "custom",
              path: ["website"],
              message: "Enter a web address (e.g. mikesplumbing.com) or leave it blank.",
            });
          }
        } else {
          need("companyName", 255, "your legal business name");
          if (!/^[0-9A-Za-z][0-9A-Za-z-]{7,14}$/.test(v.ein.trim())) {
            ctx.addIssue({
              code: "custom",
              path: ["ein"],
              message:
                country === "US"
                  ? "Enter your 9-digit EIN (numbers only, dashes ok)."
                  : "Enter your CRA business number.",
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
              message: "Enter a web address (e.g. mikesplumbing.com) or leave it blank.",
            });
          }
        }
      }

      if (editCampaign) {
        if (v.messageFlow.trim().length < 40) {
          ctx.addIssue({
            code: "custom",
            path: ["messageFlow"],
            message:
              "Carriers need at least 40 characters here: describe how customers ask you to text them.",
          });
        } else if (v.messageFlow.trim().length > 2048) {
          ctx.addIssue({
            code: "custom",
            path: ["messageFlow"],
            message: "Keep it under 2,048 characters.",
          });
        }
        for (const key of ["sample1", "sample2"] as const) {
          const value = v[key].trim();
          if (value.length < 20) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "At least 20 characters: a real text you'd send.",
            });
          } else if (value.length > 1024) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "Keep it under 1,024 characters.",
            });
          }
        }
      }
    });
  }, [editBrand, editCampaign, soleProp, country]);

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
      toast.success("Submitted. We'll email you when carriers approve it.");
      onSubmitted?.();
    } catch (cause) {
      setServerError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't resubmit. Try again in a moment.",
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
                        <FormLabel>First name</FormLabel>
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
                        <FormLabel>Last name</FormLabel>
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
                          Last 4 of your {country === "US" ? "SSN" : "SIN"}
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
                          Carriers use it to verify you&apos;re a real person.
                          We never store the full number.
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
                          <Input inputMode="tel" autoComplete="tel" {...field} />
                        </FormControl>
                        <FormDescription>
                          A verification code is texted here after you resubmit.
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
                      <FormLabel>Legal business name</FormLabel>
                      <FormControl>
                        <Input autoComplete="organization" {...field} />
                      </FormControl>
                      <FormDescription>
                        Exactly as it appears on your{" "}
                        {country === "US" ? "EIN letter" : "CRA registration"}.
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
                        {country === "US" ? "EIN" : "Business number"}
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
                  <FormLabel>Business name customers know</FormLabel>
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
                    <FormLabel>Contact email</FormLabel>
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
                    <FormLabel>Contact phone</FormLabel>
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
                  <FormLabel>Street address</FormLabel>
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
                    <FormLabel>City</FormLabel>
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
                    <FormLabel>{country === "US" ? "State" : "Province"}</FormLabel>
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
                      {country === "US" ? "ZIP code" : "Postal code"}
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
                      Website{soleProp ? " (optional)" : ""}
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
                    <FormLabel>Line of work</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TCR_VERTICALS.map((vertical) => (
                          <SelectItem key={vertical} value={vertical}>
                            {verticalLabel(vertical)}
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
                  <FormLabel>How customers ask you to text them</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormDescription>
                    Plain words work best. For example, &quot;Customers text our
                    business number first, or ask us in person or by phone to
                    text them.&quot;
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
                  <FormLabel>Example text you send</FormLabel>
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
                  <FormLabel>Another example</FormLabel>
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
          {busy ? "Submitting…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
