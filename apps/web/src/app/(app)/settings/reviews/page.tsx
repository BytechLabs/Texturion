"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { DEFAULT_REVIEW_MESSAGE } from "@/lib/settings/away-preview";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

function ReviewsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading review settings">
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function ReviewLinkCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [link, setLink] = useState(company.google_review_link ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLink(company.google_review_link ?? "");
  }, [company.google_review_link]);

  const trimmed = link.trim();
  const dirty = trimmed !== (company.google_review_link ?? "");
  const invalid = trimmed.length > 0 && !isHttpUrl(trimmed);

  function save() {
    setError(null);
    if (invalid) {
      setError("That doesn't look like a link. Paste the full https:// URL.");
      return;
    }
    update.mutate(
      { google_review_link: trimmed.length > 0 ? trimmed : null },
      {
        onSuccess: () =>
          toast.success(
            trimmed.length > 0 ? "Review link saved." : "Review link removed.",
          ),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the link. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Google review link"
      description="Paste the link customers use to leave you a Google review. With it saved, {review_link} fills in automatically wherever you use it in a text or template."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save link"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {canEdit ? (
          <div className="space-y-2">
            <Label htmlFor="review-link" className="sr-only">
              Google review link
            </Label>
            <Input
              id="review-link"
              type="url"
              inputMode="url"
              placeholder="https://g.page/r/…/review"
              value={link}
              maxLength={2000}
              aria-invalid={invalid}
              disabled={update.isPending}
              onChange={(e) => setLink(e.target.value)}
            />
            {invalid && (
              <p className="text-xs text-destructive">
                Enter a full https:// link.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm break-words">
            {company.google_review_link ?? "No review link set yet."}
            <span className="block text-xs text-muted-foreground">
              Only owners and admins can change the review link.
            </span>
          </p>
        )}

        <div className="rounded-md border border-border-subtle bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            How to find your link
          </p>
          <p className="mt-1">
            Search your business on Google, open your Business Profile, and
            choose &ldquo;Ask for reviews.&rdquo; Copy the short{" "}
            <code className="rounded bg-secondary px-1 py-0.5">g.page/r</code>{" "}
            link Google gives you and paste it here. We don&apos;t track or
            manage reviews — this just stores the link that{" "}
            <code className="rounded bg-secondary px-1 py-0.5">
              {"{review_link}"}
            </code>{" "}
            fills in when you text it.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            A review ask you can save as a template
          </p>
          <div className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap">
            {DEFAULT_REVIEW_MESSAGE}
          </div>
          <p className="text-xs text-muted-foreground">
            Save it under Templates — {"{business_name}"} and {"{review_link}"}{" "}
            fill in automatically when you send it.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function ReviewsSettingsPage() {
  const company = useCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title="Reviews"
      description="Store your Google review link to use in your texts and templates."
    >
      {company.isPending ? (
        <ReviewsSkeleton />
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <ReviewLinkCard company={company.data} canEdit={canEdit} />
      )}
    </SettingsPage>
  );
}
