"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PortDocumentsForm } from "@/components/settings/port-documents-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import {
  useResubmitPortRequest,
  useUpdatePortRequest,
} from "@/lib/api/porting";
import type { Country, PortRequest, UpdatePortRequestInput } from "@/lib/api/types";

/**
 * The PORTING.md §8.2 fix-and-resubmit form: edit the port data a carrier
 * flagged (PUT /v1/port-requests/:id), re-upload the LOA / invoice if needed
 * (PortDocumentsForm), then resubmit (POST /v1/port-requests/:id/resubmit,
 * documents-gated). Mirrors the registration-fix-form pattern. The server
 * re-validates + re-runs the portability check, so this only bounds the shape.
 */

interface FieldSpec {
  key: keyof UpdatePortRequestInput;
  label: (country: Country) => string;
  autoComplete?: string;
  hint?: string;
}

const FIELDS: FieldSpec[] = [
  { key: "entity_name", label: () => "Account holder name", autoComplete: "organization" },
  { key: "auth_person_name", label: () => "Authorized person", autoComplete: "name" },
  { key: "account_number", label: () => "Account number", autoComplete: "off" },
  { key: "service_street", label: () => "Service street address", autoComplete: "street-address" },
  { key: "service_locality", label: () => "City", autoComplete: "address-level2" },
  {
    key: "service_admin_area",
    label: (c) => (c === "US" ? "State" : "Province"),
    autoComplete: "address-level1",
  },
  {
    key: "service_postal_code",
    label: (c) => (c === "US" ? "ZIP code" : "Postal code"),
    autoComplete: "postal-code",
  },
];

function initialValues(port: PortRequest): Record<string, string> {
  return {
    entity_name: port.entity_name,
    auth_person_name: port.auth_person_name,
    account_number: "",
    service_street: port.service_street,
    service_locality: port.service_locality,
    service_admin_area: port.service_admin_area,
    service_postal_code: port.service_postal_code,
  };
}

export function PortFixForm({
  port,
  country,
}: {
  port: PortRequest;
  country: Country;
}) {
  const update = useUpdatePortRequest(port.id);
  const resubmit = useResubmitPortRequest(port.id);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(port),
  );
  const [error, setError] = useState<string | null>(null);

  const hasDocuments = port.has_loa && port.has_invoice;

  function set(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  }

  async function onResubmit() {
    setError(null);

    // Only send fields the owner actually changed (account_number starts blank —
    // it's write-only, so an empty value means "leave it as-is").
    const patch: UpdatePortRequestInput = {};
    for (const field of FIELDS) {
      const value = values[field.key]?.trim() ?? "";
      if (field.key === "account_number") {
        if (value) patch.account_number = value;
        continue;
      }
      if (value) patch[field.key] = value;
    }

    // Required text fields must not be blanked.
    for (const field of FIELDS) {
      if (field.key === "account_number") continue;
      if (!values[field.key]?.trim()) {
        setError("Every field except the account number needs a value.");
        return;
      }
    }

    try {
      if (Object.keys(patch).length > 0) {
        await update.mutateAsync(patch);
      }
      await resubmit.mutateAsync();
      toast.success("Resubmitted. We'll email you as it moves along.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't resubmit the transfer. Try again in a moment.",
      );
    }
  }

  const busy = update.isPending || resubmit.isPending;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`fix-${field.key}`}>{field.label(country)}</Label>
            <Input
              id={`fix-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) => set(field.key, e.target.value)}
              autoComplete={field.autoComplete}
              placeholder={
                field.key === "account_number" && port.has_account_number
                  ? "On file, leave blank to keep it"
                  : undefined
              }
            />
          </div>
        ))}
      </div>

      {/* Re-upload a document the carrier flagged (§8.2). */}
      <div className="space-y-3 border-t border-border-subtle pt-4">
        <p className="text-sm font-medium">Documents</p>
        <PortDocumentsForm port={port} country={country} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={() => void onResubmit()} disabled={busy || !hasDocuments}>
        {busy ? "Resubmitting…" : "Fix and resubmit"}
      </Button>
      {!hasDocuments ? (
        <p className="text-[13px] text-muted-foreground">
          Upload your signed authorization and a recent bill above before
          resubmitting.
        </p>
      ) : null}
    </div>
  );
}
