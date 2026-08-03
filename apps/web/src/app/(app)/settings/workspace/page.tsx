"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { CloseWorkspaceCard } from "@/components/settings/close-workspace-card";
import { ContactFieldsCard } from "@/components/settings/contact-fields-card";
import { LeaveWorkspaceCard } from "@/components/settings/leave-workspace-card";
import { ExportDataCard } from "@/components/settings/export-data-card";
import { TimezoneSelect } from "@/components/settings/timezone-select";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useRegistration } from "@/lib/api/registration";
import type { CompanyView, RegistrationRow } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

// Mirrors the API company schema (apps/api/src/routes/companies.ts): name 1–200.
const companyNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your company name.")
    .max(200, "Keep it under 200 characters."),
});
type CompanyNameValues = z.infer<typeof companyNameSchema>;

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading workspace settings">
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function CompanyNameCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const update = useUpdateCompany();

  const form = useForm<CompanyNameValues>({
    resolver: zodResolver(companyNameSchema),
    defaultValues: { name: company.name },
  });

  // Keep the field in sync if the company name changes elsewhere (realtime).
  useEffect(() => {
    form.reset({ name: company.name });
  }, [company.name, form]);

  const name = form.watch("name");
  const dirty = name.trim() !== company.name;

  function onSubmit(values: CompanyNameValues) {
    if (!dirty) return;
    update.mutate(
      { name: values.name },
      {
        onSuccess: () => toast.success("Company name saved."),
        onError: (cause) =>
          form.setError("root", {
            message:
              cause instanceof ApiError
                ? cause.message
                : "Couldn't save the name. Try again.",
          }),
      },
    );
  }

  return (
    <SettingsCard
      title="Company name"
      description="The name your customers know you by, used on your carrier registration and available as a {business_name} field in your texts."
    >
      <div className="space-y-4">
        {canEdit ? (
          <Form {...form}>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-start"
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel className="sr-only">Company name</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={200}
                        autoComplete="organization"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={!dirty || update.isPending}
                className="sm:self-start"
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </form>
          </Form>
        ) : (
          <p className="text-sm">
            {company.name}
            <span className="block text-xs text-muted-foreground">
              Only owners and admins can rename the workspace.
            </span>
          </p>
        )}
        {form.formState.errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

function identifierLabel(
  brand: RegistrationRow,
  country: "US" | "CA",
): string {
  if (brand.sole_proprietor) {
    return country === "US" ? "SSN (last 4)" : "SIN (last 4)";
  }
  return country === "US" ? "EIN" : "Business number";
}

function field(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function BusinessIdentityCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const registration = useRegistration();

  const description =
    "What carriers have on file for your business. It comes from your texting registration.";

  if (registration.isPending) {
    return (
      <SettingsCard title="Business identification" description={description}>
        <Skeleton className="h-20 w-full" />
      </SettingsCard>
    );
  }
  if (registration.isError) {
    return (
      <SettingsCard title="Business identification" description={description}>
        <LoadError onRetry={() => registration.refetch()} />
      </SettingsCard>
    );
  }

  const brand = registration.data.brand;
  if (!brand) {
    return (
      <SettingsCard title="Business identification" description={description}>
        <p className="text-sm text-muted-foreground">
          {company.country === "CA" && !company.us_texting_enabled
            ? "No registration needed. Canadian texting works without one. Enabling US texting adds it."
            : "No registration details on file yet."}{" "}
          <Link
            href="/settings/numbers"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            See registration
          </Link>
        </p>
      </SettingsCard>
    );
  }

  const data = brand.data;
  const legalName = brand.sole_proprietor
    ? `${field(data, "firstName")} ${field(data, "lastName")}`.trim()
    : field(data, "companyName");
  const address = [
    field(data, "street"),
    field(data, "city"),
    field(data, "state"),
    field(data, "postalCode"),
  ]
    .filter(Boolean)
    .join(", ");

  const rows: [string, string][] =
    role === "owner" || role === "admin"
      ? [
          ["Legal name", legalName],
          [identifierLabel(brand, company.country), field(data, "ein")],
          ["Address", address],
          ["Website", field(data, "website")],
          ["Contact", field(data, "email")],
        ]
      : [];

  return (
    <SettingsCard title="Business identification" description={description}>
      <div className="space-y-3">
        {rows.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {rows
              .filter(([, value]) => value !== "")
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Registration is {brand.status === "approved" ? "approved" : "on file"}.
            Owners and admins can see the full details.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Need to change something?{" "}
          <Link
            href="/settings/numbers"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage registration
          </Link>
        </p>
      </div>
    </SettingsCard>
  );
}

function TimezoneCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);

  const timezone = company.timezone;
  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date());

  function save(zone: string) {
    setError(null);
    update.mutate(
      { timezone: zone },
      {
        onSuccess: () => toast.success("Timezone saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the timezone. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Timezone"
      description="Dates in emails about your workspace are framed in your business's local time."
    >
      <div className="space-y-2">
        {canEdit ? (
          <TimezoneSelect
            value={timezone}
            onChange={save}
            disabled={update.isPending}
          />
        ) : (
          <p className="text-sm">{timezone.replace(/_/g, " ")}</p>
        )}
        <p className="text-xs text-muted-foreground">
          It&apos;s {localTime} in {timezone.replace(/_/g, " ")} right now.
          Texting quiet hours always use each customer&apos;s local time, not
          this one.
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change the timezone.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

/**
 * #393: sign the first text to a new customer with the business name.
 *
 * Deliberately NOT titled "identification" — the card above uses that word for
 * carrier registration data, and two cards saying it would read as one thing.
 * The segment cost is disclosed because it is real: the suffix can push a long
 * text into a second part, and the customer pays for parts.
 */
function SignTextsCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const update = useUpdateCompany();
  const [enabled, setEnabled] = useState(company.first_message_identification);
  const [error, setError] = useState<string | null>(null);

  // Another admin's flip, or a refetch, wins over our local mirror.
  useEffect(() => {
    setEnabled(company.first_message_identification);
  }, [company.first_message_identification]);

  function toggle(next: boolean) {
    setError(null);
    setEnabled(next); // optimistic; reverted below on failure
    update.mutate(
      { first_message_identification: next },
      {
        onError: (cause) => {
          setEnabled(company.first_message_identification);
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          );
        },
      },
    );
  }

  // Server-derived, and only rendered once the server confirms — composing the
  // suffix here could drift from what actually sends and gets billed.
  const suffix = company.first_message_identification_suffix;

  return (
    <SettingsCard
      title="Sign your texts"
      description="Add your business name to the first text you send someone, so a message from an unknown number says who it is from."
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="sign-texts" className="text-sm font-medium">
              Sign the first text to a new customer
            </Label>
            <p className="text-sm text-muted-foreground">
              Once per customer. Replies and later texts are never signed.
            </p>
          </div>
          <Switch
            id="sign-texts"
            checked={enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={toggle}
          />
        </div>

        {enabled && suffix ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              What gets added
            </p>
            <div
              aria-live="polite"
              className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
            >
              {suffix.trim()}
            </div>
            <p className="text-xs text-muted-foreground">
              That is {suffix.trim().length} characters, so a long first text can
              be sent in two parts instead of one.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {!canEdit ? (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can change how texts are signed.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

/**
 * #225 ask 5 — the quiet-hours confirmation, for the trade that works nights.
 *
 * COPY DISCIPLINE, AND IT IS THE WHOLE DESIGN. This must never read as
 * "turn off quiet hours". Automated texts are held to the customer's window no
 * matter what this says, and an owner who believed otherwise would be relying on
 * a permission we did not grant. So every sentence names the PROMPT, and the
 * consequence line says out loud what the switch does not do.
 */
function QuietHoursCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const update = useUpdateCompany();
  const [enabled, setEnabled] = useState(company.quiet_hours_confirm_enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(company.quiet_hours_confirm_enabled);
  }, [company.quiet_hours_confirm_enabled]);

  function toggle(next: boolean) {
    setError(null);
    setEnabled(next);
    update.mutate(
      { quiet_hours_confirm_enabled: next },
      {
        onError: (cause) => {
          setEnabled(company.quiet_hours_confirm_enabled);
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          );
        },
      },
    );
  }

  return (
    <SettingsCard
      title="Texting a new customer at night"
      description="Starting a brand-new conversation between 8pm and 8am the customer's time asks you to confirm first."
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="quiet-hours-confirm" className="text-sm font-medium">
              Ask me to confirm
            </Label>
            <p className="text-sm text-muted-foreground">
              Only when you start the conversation. Replying to a customer who
              texted or called you is never interrupted.
            </p>
          </div>
          <Switch
            id="quiet-hours-confirm"
            checked={enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={toggle}
          />
        </div>

        {/* The consequence, inline and at the moment of the decision — and the
            second sentence is the one that matters: it forecloses the reading
            that this permits automated night texts. */}
        {!enabled ? (
          <div
            aria-live="polite"
            className="space-y-2 rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm"
          >
            <p>
              You will not be asked. A text you start at 2am goes straight out,
              and it is on you that the customer wanted to hear from you then.
            </p>
            <p className="text-muted-foreground">
              This does not change automated texts. Reminders and anything else
              we send on your behalf still wait for the customer&apos;s morning,
              whatever this is set to.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {!canEdit ? (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can change this.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

export default function WorkspaceSettingsPage() {
  const company = useCompany();
  const { role } = useActiveCompany();

  return (
    <SettingsPage
      title="Workspace"
      description="Your company as customers and carriers see it."
    >
      {company.isPending ? (
        <WorkspaceSkeleton />
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <div className="space-y-6">
          <CompanyNameCard company={company.data} />
          {/* #393: directly under the name, because it is the name this adds to
              a first text — the strongest relationship on the page. */}
          <SignTextsCard company={company.data} />
          <BusinessIdentityCard company={company.data} />
          <TimezoneCard company={company.data} />
          {/* #225: directly under the timezone card. Both answer "whose clock
              are we on", and the pair reads as one idea — yours above, the
              customer's here. */}
          <QuietHoursCard company={company.data} />
          {/* #291: the fields this workspace keeps on a customer. Below the
              two clock cards because it is a different question — those are
              about when we contact people, this is about what we know about
              them — and above the export card, which carries these fields out
              in its columns. */}
          <ContactFieldsCard canEdit={role === "owner" || role === "admin"} />
          {/* #227: above the close card on purpose — taking a copy of your
              data is the thing you want BEFORE destroying it. */}
          {(role === "owner" || role === "admin") && <ExportDataCard />}
          {/* #341: last, and only for the owner — ending the account is not an
              everyday setting and should not sit among them. */}
          {role === "owner" && <CloseWorkspaceCard company={company.data} />}
          {/* #406: the mirror image, and the one the owner does NOT get — an
              owner leaving would strand a workspace nobody can administer
              (#332). Everyone else can end their own access without having to
              ask the person they may have just stopped working for. */}
          {role !== "owner" && <LeaveWorkspaceCard company={company.data} />}
        </div>
      )}
    </SettingsPage>
  );
}
