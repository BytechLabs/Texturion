"use client";

import { lookupAreaCode, NANP_AREA_CODES } from "@jobtext/shared";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { FooterPreview } from "@/components/settings/footer-preview";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useRegistration } from "@/lib/api/registration";
import type { CompanyView, RegistrationRow } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

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
  const [name, setName] = useState(company.name);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const dirty = trimmed !== company.name;

  function save() {
    if (!dirty || trimmed === "") return;
    setError(null);
    update.mutate(
      { name: trimmed },
      {
        onSuccess: () => toast.success("Company name saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the name. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Company name"
      description="Shown to your customers — it signs the first text you send them."
    >
      <div className="space-y-4">
        {canEdit ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="company-name" className="sr-only">
                Company name
              </Label>
              <Input
                id="company-name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                autoComplete="organization"
              />
            </div>
            <Button
              type="submit"
              disabled={!dirty || trimmed === "" || update.isPending}
              className="sm:self-start"
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : (
          <p className="text-sm">
            {company.name}
            <span className="block text-xs text-muted-foreground">
              Only owners and admins can rename the workspace.
            </span>
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <FooterPreview businessName={canEdit ? name : company.name} />
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
    "What carriers have on file for your business — it comes from your texting registration.";

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
            ? "No registration needed — Canadian texting works without one. Enabling US texting adds it."
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
  const activeNumber = company.numbers.find(
    (n) => n.status !== "released" && n.number_e164 !== null,
  );
  const entry = activeNumber?.number_e164
    ? lookupAreaCode(activeNumber.number_e164)
    : (NANP_AREA_CODES[company.requested_area_code] ?? null);

  const timezone = entry?.geographic ? entry.timezone : null;
  const localTime = timezone
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date())
    : null;

  return (
    <SettingsCard title="Timezone">
      {timezone ? (
        <p className="text-sm">
          {timezone.replace(/_/g, " ")}
          <span className="text-muted-foreground"> — {localTime} right now</span>
          <span className="block text-xs text-muted-foreground">
            From your business number&apos;s area code. Quiet-hours checks use
            each customer&apos;s local time, not this one.
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          We&apos;ll show your timezone once your number is set up.
        </p>
      )}
    </SettingsCard>
  );
}

export default function WorkspaceSettingsPage() {
  const company = useCompany();

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
        <div className="space-y-4">
          <CompanyNameCard company={company.data} />
          <BusinessIdentityCard company={company.data} />
          <TimezoneCard company={company.data} />
        </div>
      )}
    </SettingsPage>
  );
}
