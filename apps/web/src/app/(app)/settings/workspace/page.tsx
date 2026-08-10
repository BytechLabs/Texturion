"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { capabilitiesOf } from "@loonext/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { CloseWorkspaceCard } from "@/components/settings/close-workspace-card";
import { ContactFieldsCard } from "@/components/settings/contact-fields-card";
import { LanguageCard } from "@/components/settings/language-card";
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
import { useT, type Translate } from "@/i18n/provider";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useRegistration } from "@/lib/api/registration";
import type { CompanyView, RegistrationRow } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/*
 * Mirrors the API company schema (apps/api/src/routes/companies.ts): name 1–200.
 *
 * A factory rather than a module-level constant: both messages are drawn under
 * the field, so they are copy and belong in the catalogue with the rest of the
 * page.
 */
const COMPANY_NAME_MAX = 200;

function makeCompanyNameSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("appShell.workspaceNameRequired"))
      .max(
        COMPANY_NAME_MAX,
        t("appShell.workspaceNameTooLong", {
          max: COMPANY_NAME_MAX.toLocaleString(),
        }),
      ),
  });
}
type CompanyNameValues = z.infer<ReturnType<typeof makeCompanyNameSchema>>;

function WorkspaceSkeleton() {
  const t = useT();
  return (
    <div className="space-y-4" aria-label={t("appShell.workspaceLoading")}>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function CompanyNameCard({ company }: { company: CompanyView }) {
  const t = useT();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const update = useUpdateCompany();

  const schema = useMemo(() => makeCompanyNameSchema(t), [t]);
  const form = useForm<CompanyNameValues>({
    resolver: zodResolver(schema),
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
        onSuccess: () => toast.success(t("appShell.workspaceNameSaved")),
        onError: (cause) =>
          form.setError("root", {
            message:
              cause instanceof ApiError
                ? cause.message
                : t("appShell.workspaceNameSaveFailed"),
          }),
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.workspaceNameTitle")}
      description={t("appShell.workspaceNameDescription")}
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
                    <FormLabel className="sr-only">
                      {t("appShell.workspaceNameTitle")}
                    </FormLabel>
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
                {update.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </form>
          </Form>
        ) : (
          <p className="text-sm">
            {company.name}
            <span className="block text-xs text-muted-foreground">
              {t("appShell.workspaceRenameOwnersOnly")}
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
  t: Translate,
  brand: RegistrationRow,
  country: "US" | "CA",
): string {
  if (brand.sole_proprietor) {
    return country === "US"
      ? t("appShell.workspaceIdSsn")
      : t("appShell.workspaceIdSin");
  }
  return country === "US"
    ? t("appShell.workspaceIdEin")
    : t("appShell.workspaceIdBusinessNumber");
}

function field(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function BusinessIdentityCard({ company }: { company: CompanyView }) {
  const t = useT();
  const { role } = useActiveCompany();
  const registration = useRegistration();

  const title = t("appShell.workspaceIdentityTitle");
  const description = t("appShell.workspaceIdentityDescription");

  if (registration.isPending) {
    return (
      <SettingsCard title={title} description={description}>
        <Skeleton className="h-20 w-full" />
      </SettingsCard>
    );
  }
  if (registration.isError) {
    return (
      <SettingsCard title={title} description={description}>
        <LoadError onRetry={() => registration.refetch()} />
      </SettingsCard>
    );
  }

  const brand = registration.data.brand;
  if (!brand) {
    return (
      <SettingsCard title={title} description={description}>
        <p className="text-sm text-muted-foreground">
          {company.country === "CA" && !company.us_texting_enabled
            ? t("appShell.workspaceNoRegistrationNeeded")
            : t("appShell.workspaceNoRegistrationYet")}{" "}
          <Link
            href="/settings/numbers"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("appShell.workspaceSeeRegistration")}
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
          [t("appShell.workspaceLegalName"), legalName],
          [identifierLabel(t, brand, company.country), field(data, "ein")],
          [t("appShell.workspaceAddress"), address],
          [t("appShell.workspaceWebsite"), field(data, "website")],
          [t("appShell.workspaceContact"), field(data, "email")],
        ]
      : [];

  return (
    <SettingsCard title={title} description={description}>
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
            {t("appShell.workspaceRegistrationSummary", {
              status:
                brand.status === "approved"
                  ? t("appShell.workspaceRegistrationApproved")
                  : t("appShell.workspaceRegistrationOnFile"),
            })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("appShell.workspaceNeedChange")}{" "}
          <Link
            href="/settings/numbers"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("appShell.workspaceManageRegistration")}
          </Link>
        </p>
      </div>
    </SettingsCard>
  );
}

function TimezoneCard({ company }: { company: CompanyView }) {
  const t = useT();
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
        onSuccess: () => toast.success(t("appShell.workspaceTimezoneSaved")),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("appShell.workspaceTimezoneSaveFailed"),
          ),
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.workspaceTimezoneTitle")}
      description={t("appShell.workspaceTimezoneDescription")}
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
          {t("appShell.workspaceLocalTimeNote", {
            time: localTime,
            timezone: timezone.replace(/_/g, " "),
          })}
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            {t("appShell.workspaceTimezoneOwnersOnly")}
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
  const t = useT();
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
              : t("appShell.saveFailed"),
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
      title={t("appShell.workspaceSignTitle")}
      description={t("appShell.workspaceSignDescription")}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="sign-texts" className="text-sm font-medium">
              {t("appShell.workspaceSignLabel")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("appShell.workspaceSignBody")}
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
              {t("appShell.workspaceSignPreviewLabel")}
            </p>
            <div
              aria-live="polite"
              className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
            >
              {suffix.trim()}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("appShell.workspaceSignLengthNote", {
                length: suffix.trim().length,
              })}
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
            {t("appShell.workspaceSignOwnersOnly")}
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
  const t = useT();
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
              : t("appShell.saveFailed"),
          );
        },
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.workspaceNightTitle")}
      description={t("appShell.workspaceNightDescription")}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="quiet-hours-confirm" className="text-sm font-medium">
              {t("appShell.workspaceNightLabel")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("appShell.workspaceNightBody")}
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
            <p>{t("appShell.workspaceNightOffConsequence")}</p>
            <p className="text-muted-foreground">
              {t("appShell.workspaceNightOffBoundary")}
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
            {t("appShell.workspaceNightOwnersOnly")}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

export default function WorkspaceSettingsPage() {
  const t = useT();
  const company = useCompany();
  const { role } = useActiveCompany();

  /**
   * #595 — the same question the server asks.
   *
   * `POST /v1/exports` is `requireCapability("contacts.bulk")`
   * (apps/api/src/routes/exports.ts), and until now this card asked whether you
   * were called "owner" or "admin" instead. Since #315 a role is a capability
   * SET, not a rung, so a preset holding `contacts.bulk` would have been refused
   * a card the server would happily have served it — and the fix for that is a
   * pull request, which is the wrong shape for a permission.
   *
   * It is also why the bookkeeper never sees this. They were already excluded,
   * but by where they sat on the owner/admin line rather than by anyone deciding
   * they should be: `contacts.bulk` is the departing-employee signature
   * (capabilities.ts), and somebody who only does the books does not carry it.
   * Same rule, now stated.
   *
   * *Applying: Absent, not disabled — a control you cannot use is noise, and a
   * disabled one is an invitation to go asking for the rank that enables it.*
   */
  const canExportWorkspace = role
    ? capabilitiesOf(role).includes("contacts.bulk")
    : false;

  return (
    <SettingsPage
      title={t("appShell.workspaceTitle")}
      description={t("appShell.workspaceDescription")}
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
          {/* #228: under the two clock cards rather than between them, because
              those two are a documented pair and splitting them would cost
              more than the adjacency gains. It belongs here all the same: the
              three together are everything about how an automated text reaches
              a customer, whose clock it waits for and whose words it uses. */}
          <LanguageCard
            company={company.data}
            canEdit={role === "owner" || role === "admin"}
          />
          {/* #291: the fields this workspace keeps on a customer. Below the
              two clock cards because it is a different question — those are
              about when we contact people, this is about what we know about
              them — and above the export card, which carries these fields out
              in its columns. */}
          <ContactFieldsCard canEdit={role === "owner" || role === "admin"} />
          {/* #227: above the close card on purpose — taking a copy of your
              data is the thing you want BEFORE destroying it. */}
          {canExportWorkspace && <ExportDataCard />}
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
