"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import {
  usSendApproved,
  usTextingOff,
} from "@/components/thread/composer-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { awayEmergencyNotice } from "@loonext/shared";

import { previewAwayMessage } from "@/lib/settings/away-preview";
import {
  isDirty,
  toBusinessHours,
  toFormState,
  WEEKDAY_LABEL,
  type DayFormState,
} from "@/lib/settings/business-hours-form";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

function AwaySkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading away-reply settings">
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

/** The per-weekday open/close grid (Step 1: business hours, company-local). */
function BusinessHoursCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const initial = useMemo(
    () => toFormState(company.business_hours),
    [company.business_hours],
  );
  const [days, setDays] = useState<DayFormState[]>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDays(initial), [initial]);

  const dirty = isDirty(days, initial);

  function patchDay(weekday: string, patch: Partial<DayFormState>) {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  }

  function save() {
    setError(null);
    update.mutate(
      { business_hours: toBusinessHours(days) },
      {
        onSuccess: () => toast.success("Business hours saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save your hours. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Business hours"
      description={`When you're open, in ${company.timezone.replace(/_/g, " ")}. Texts that arrive outside these hours can get your away reply. This is separate from each customer's texting quiet hours.`}
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save hours"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {days.map((day) => (
          <div
            key={day.weekday}
            className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0"
          >
            <div className="flex min-w-[9.5rem] items-center gap-2.5">
              <Switch
                id={`open-${day.weekday}`}
                checked={day.enabled}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(enabled) =>
                  patchDay(day.weekday, { enabled })
                }
              />
              <Label htmlFor={`open-${day.weekday}`} className="text-sm">
                {WEEKDAY_LABEL[day.weekday]}
              </Label>
            </div>
            {day.enabled ? (
              <div className="flex items-center gap-2 text-sm">
                <Input
                  type="time"
                  aria-label={`${WEEKDAY_LABEL[day.weekday]} open time`}
                  value={day.open}
                  disabled={!canEdit || update.isPending}
                  onChange={(e) =>
                    patchDay(day.weekday, { open: e.target.value })
                  }
                  className="w-[7.5rem]"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`${WEEKDAY_LABEL[day.weekday]} close time`}
                  value={day.close}
                  disabled={!canEdit || update.isPending}
                  onChange={(e) =>
                    patchDay(day.weekday, { close: e.target.value })
                  }
                  className="w-[7.5rem]"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change business hours.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

/** The away-reply toggle + owner-authored message + live preview (Step 1). */
function AwayMessageCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [enabled, setEnabled] = useState(company.away_enabled);
  const [message, setMessage] = useState(company.away_message ?? "");
  const [emergency, setEmergency] = useState(company.emergency_keyword_enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(company.away_enabled);
    setMessage(company.away_message ?? "");
    setEmergency(company.emergency_keyword_enabled);
  }, [
    company.away_enabled,
    company.away_message,
    company.emergency_keyword_enabled,
  ]);

  const dirty =
    enabled !== company.away_enabled ||
    message.trim() !== (company.away_message ?? "").trim() ||
    emergency !== company.emergency_keyword_enabled;

  // What will actually go out — the owner's text if they wrote one, else the
  // product default. Both the preview and the emergency check read THIS, so
  // the screen can never approve of a message that isn't the one sending.
  // #414 ask 5: the SERVER says what will actually send. This screen used to
  // hold its own copy of the default and preview that, while the server sent
  // nothing at all when the owner had not written one.
  const effectiveMessage =
    message.trim().length > 0 ? message : company.away_effective_message;
  const preview = previewAwayMessage(effectiveMessage, company.name);
  const notice = awayEmergencyNotice({
    emergencyEnabled: emergency,
    awayMessage: effectiveMessage,
  });

  function save() {
    setError(null);
    const trimmed = message.trim();
    if (enabled && trimmed.length === 0) {
      setError("Write your away message before turning the away reply on.");
      return;
    }
    update.mutate(
      {
        away_enabled: enabled,
        away_message: trimmed.length > 0 ? trimmed : null,
        emergency_keyword_enabled: emergency,
      },
      {
        onSuccess: () => toast.success("Away reply saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the away reply. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Away reply"
      description="One automatic text back when someone reaches you outside your business hours, in your words, so you never lose an after-hours emergency."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save away reply"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="away-enabled" className="text-sm font-medium">
              Send an away reply after hours
            </Label>
            <p className="text-sm text-muted-foreground">
              Fires once per conversation when a customer first texts outside
              your hours. Replies to their ongoing thread are never gated.
            </p>
          </div>
          <Switch
            id="away-enabled"
            checked={enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* The send gates refuse a US destination until the campaign is
            approved, and the away reply is best-effort: it is skipped without
            a trace. Turning the switch on and hearing nothing more is the
            first week of every US workspace, so say it at the switch. */}
        {!usSendApproved(company) && enabled ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            {usTextingOff(company)
              ? "Customers with US numbers won't get this reply: US texting isn't on for this workspace. Canadian numbers get it now."
              : "Customers with US numbers won't get this reply until your registration is approved. Canadian numbers get it now."}
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="away-message" className="text-sm font-medium">
            Your away message
          </Label>
          <Textarea
            id="away-message"
            value={message}
            disabled={!canEdit || update.isPending}
            maxLength={1000}
            rows={4}
            placeholder={company.away_effective_message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            You can use{" "}
            <code className="rounded bg-secondary px-1 py-0.5">
              {"{first_name}"}
            </code>{" "}
            and{" "}
            <code className="rounded bg-secondary px-1 py-0.5">
              {"{business_name}"}
            </code>
            . Write it so an emergency still reaches you, never just
            &ldquo;we&apos;re closed.&rdquo;
          </p>
        </div>

        {/* #414: the switch sits directly under the message that makes the
            offer, not on a separate notifications page. They are one decision
            — a message inviting URGENT with the mechanism off is the exact
            defect this issue is about, and an owner can only notice it if
            both are on screen at once. */}
        <div className="space-y-3 border-t border-border-subtle pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="emergency-enabled" className="text-sm font-medium">
                Treat a reply of URGENT as an emergency
              </Label>
              <p className="text-sm text-muted-foreground">
                Texts back that start with URGENT, EMERGENCY, 911 or SOS reach
                everyone on the crew straight away, at the priority that wakes a
                phone — no away reply, and never held back by your daily
                notification limit.
              </p>
            </div>
            <Switch
              id="emergency-enabled"
              checked={emergency}
              disabled={!canEdit || update.isPending}
              onCheckedChange={setEmergency}
            />
          </div>

          {/* #453: which sentence appears is decided in `shared`, so this
              screen, Android and iOS cannot drift into three wordings of the
              same warning. Only the tone-to-colour mapping is ours. A `warn`
              gets amber and role="alert"; a `hint` stays a quiet aside,
              because an owner who does not offer emergency service has done
              nothing wrong. */}
          {notice ? (
            notice.tone === "warn" ? (
              <p
                role="alert"
                className="rounded-md bg-warning/10 px-3 py-2 text-sm"
              >
                {notice.text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{notice.text}</p>
            )
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <div
            aria-live="polite"
            className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
          >
            {preview}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change the away reply.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function AwayReplySettingsPage() {
  const company = useCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title="Business hours & away reply"
      description="Catch after-hours texts with one reply in your own words."
    >
      {company.isPending ? (
        <AwaySkeleton />
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <div className="space-y-6">
          <BusinessHoursCard company={company.data} canEdit={canEdit} />
          <AwayMessageCard company={company.data} canEdit={canEdit} />
        </div>
      )}
    </SettingsPage>
  );
}
