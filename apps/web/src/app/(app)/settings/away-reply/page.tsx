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
import { ClosedDatesCard } from "@/components/settings/closed-dates-card";
import { EmergencyCard } from "@/components/settings/emergency-card";
import { OnCallCard } from "@/components/settings/on-call-card";
import { ReminderRulesCard } from "@/components/settings/reminder-rules-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { WeeklyHoursGrid } from "@/components/settings/weekly-hours-grid";
import { ApiError } from "@/lib/api/error";
import {
  awayEmergencyNotice,
  effectiveEmergencyKeywords,
  emergencyWordList,
} from "@loonext/shared";

import { previewAwayMessage } from "@/lib/settings/away-preview";
import {
  isDirty,
  toBusinessHours,
  toFormState,
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
        {/*
          #307: the same grid a single number's hours use. Two copies would
          have drifted the first time either was touched.
        */}
        <WeeklyHoursGrid
          days={days}
          disabled={!canEdit || update.isPending}
          idPrefix="open"
          onChange={patchDay}
        />
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
    // #460: THIS workspace's words. Warning against the product list when the
    // owner watches for their own would be the product arguing with a setting
    // it offers, and a warning that survives the fix teaches people to ignore
    // warnings.
    // Through the shared resolver, which treats a missing or empty list as the
    // product's. A response from an API that predates #460 has no list at all,
    // and a settings page that throws on an older server is a worse bug than
    // the copy this replaces.
    keywords: effectiveEmergencyKeywords(company.emergency_effective_keywords),
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
                Treat an emergency word as an emergency
              </Label>
              {/* #460: names the words THIS workspace watches for. Hardcoding
                  the product's four was fine until an owner could change them,
                  at which point a switch label naming words nothing matches is
                  the #414 defect in a different place. */}
              <p className="text-sm text-muted-foreground">
                Texts back that start with{" "}
                {emergencyWordList(
                  effectiveEmergencyKeywords(company.emergency_effective_keywords),
                )}{" "}
                reach
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

          {/* #402: directly under the weekly schedule it overrides. These
              dates only mean anything as an exception to it, and an owner
              looking for "we're shut on Boxing Day" looks where they set
              their hours.
              *Applying: Relationship Strength.* */}
          <ClosedDatesCard company={company.data} canEdit={canEdit} />
          <AwayMessageCard company={company.data} canEdit={canEdit} />

          {/* #460: directly beneath the away message, which is the sentence
              that TELLS a customer the word. An owner changing the word has to
              see the offer in the same scroll — the same adjacency argument
              #414 used to put the switch on the away card.
              *Applying: Relationship Strength & Chunking.* */}
          <EmergencyCard company={company.data} canEdit={canEdit} />

          {/* #237: last, and on this page rather than a seventeenth settings
              row. Every card above it answers "what do we send automatically,
              and in whose words" — the away reply, the closed dates, the
              emergency reply. A reminder is the same question with a different
              trigger, and a section list already sixteen rows long does not
              hold another for a two-rule form.
              *Applying: Chunking & Zen of Clarity.* */}
          <ReminderRulesCard canEdit={canEdit} />
          {/* #244: on this page for the same reason as everything above it —
              every card here answers "what happens outside working hours". The
              away reply is what the CUSTOMER gets; this is who on the crew is
              woken, and the two are read together or not at all.
              *Applying: Relationship Strength — a strong semantic relationship
              gets tight grouping, not a seventeenth settings row.* */}
          <OnCallCard canEdit={canEdit} />
        </div>
      )}
    </SettingsPage>
  );
}
