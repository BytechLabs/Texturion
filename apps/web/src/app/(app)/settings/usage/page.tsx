"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";

import { CapControl } from "@/components/settings/cap-control";
import { CalmEmptyState } from "@/components/settings/empty-state";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tertiary } from "@/components/ui/tertiary";
import { useCompany } from "@/lib/api/companies";
import { useUsage } from "@/lib/api/usage";
import type {
  Usage,
  UsageMms,
  UsageMonth,
  UsageStorage,
  UsageVoice,
} from "@/lib/api/types";
import {
  capLabel,
  capSegments,
  normalizeMultiplier,
} from "@/lib/settings/cap-control";
import { cn } from "@/lib/utils";

function dollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function periodRange(usage: Usage): string | null {
  if (!usage.period_start || !usage.period_end) return null;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(usage.period_start).toLocaleDateString(
    undefined,
    options,
  );
  const end = new Date(usage.period_end).toLocaleDateString(undefined, options);
  return `${start} – ${end}`;
}

function PeriodMeter({ usage }: { usage: Usage }) {
  const ratio =
    usage.included_segments > 0
      ? usage.used_segments / usage.included_segments
      : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        {/* The §3.6 "balance"-style hero: the used figure in the tokens-track
            emotional-number scale (32–36px tabular, tight tracking) with the
            calm fade+rise reveal. The "of N included" recedes to body-secondary;
            the period drops to tertiary. */}
        <span className="app-emotional-number app-motion-message-in text-foreground">
          {usage.used_segments.toLocaleString()}
        </span>
        <p className="pb-0.5 text-sm text-muted-foreground">
          of {usage.included_segments.toLocaleString()} included messages used
        </p>
        {periodRange(usage) && (
          <Tertiary
            as="p"
            className="ml-auto pb-0.5 text-sm tabular-nums"
          >
            {periodRange(usage)}
          </Tertiary>
        )}
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={usage.included_segments}
        aria-valuenow={Math.min(usage.used_segments, usage.included_segments)}
        aria-label={`${usage.used_segments} of ${usage.included_segments} included messages used`}
        className="h-3 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-200 ease-out",
            warning ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="space-y-1 text-sm">
        {usage.overage_segments > 0 ? (
          <p>
            <span className="font-medium tabular-nums">
              {usage.overage_segments.toLocaleString()}
            </span>{" "}
            over your included amount —{" "}
            <span className="font-medium tabular-nums">
              {dollars(usage.projected_overage_cents)}
            </span>{" "}
            in overage on your next invoice.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No overage this period — {dollars(0)} extra so far.
          </p>
        )}
        {usage.cap_segments !== null ? (
          <p className="text-muted-foreground">
            Sending pauses at{" "}
            <span className="tabular-nums">
              {usage.cap_segments.toLocaleString()}
            </span>{" "}
            messages.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No cap — sending never pauses, overage is billed as you go.
          </p>
        )}
        {usage.inbound_segments > 0 && (
          <p className="text-muted-foreground">
            <span className="tabular-nums">
              {usage.inbound_segments.toLocaleString()}
            </span>{" "}
            messages received this period.
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** One labelled storage budget bar (files, or picture messages). */
function StorageBar({
  label,
  used,
  budget,
  help,
}: {
  label: string;
  used: number;
  budget: number | null;
  help: string;
}) {
  const ratio = budget ? used / budget : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatBytes(used)} of {budget ? formatBytes(budget) : "—"}
        </span>
      </div>
      {budget !== null && (
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={Math.min(used, budget)}
          aria-label={`${label}: ${formatBytes(used)} of ${formatBytes(budget)} used`}
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-200 ease-out",
              warning ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-sm text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * D30 + #12: the two separate storage pools — files you attach to notes, and
 * picture messages customers text you. Each has its own budget (base plan + the
 * extra_storage add-on) and its own full behaviour (files: uploads pause;
 * pictures: new ones are held, text always arrives), so they get their own bar.
 */
function StorageMeter({ storage }: { storage: UsageStorage }) {
  return (
    <div className="space-y-6">
      <StorageBar
        label="Files on notes"
        used={storage.attachments_bytes}
        budget={storage.attachment_budget_bytes || null}
        help="Files you attach to notes are saved here. When it's full, delete files you no longer need to free up space."
      />
      <StorageBar
        label="Picture messages"
        used={storage.mms_bytes}
        budget={storage.mms_budget_bytes || null}
        help="Pictures customers text you are saved here. When it's full, new pictures are held — the message text always comes through — until you free up space or move to a larger plan."
      />
    </div>
  );
}

/** #12: call-forwarding minutes used vs the plan allowance. */
function VoiceMeter({ voice }: { voice: UsageVoice }) {
  const ratio =
    voice.included_minutes > 0
      ? voice.used_minutes / voice.included_minutes
      : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium tabular-nums">
          {voice.used_minutes.toLocaleString()} min
        </span>
        <span className="text-muted-foreground">
          of {voice.included_minutes.toLocaleString()} included
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={voice.included_minutes}
        aria-valuenow={Math.min(voice.used_minutes, voice.included_minutes)}
        aria-label={`${voice.used_minutes} of ${voice.included_minutes} included call-forwarding minutes used`}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-200 ease-out",
            warning ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Calls forwarded to your cell use these minutes. When they&apos;re used
        up, new calls aren&apos;t forwarded — callers get your missed-call text
        instead — so your phone bill can&apos;t run past your plan.
      </p>
    </div>
  );
}

/** #12: outbound picture messages used vs the plan allowance. */
function MmsMeter({ mms }: { mms: UsageMms }) {
  const ratio =
    mms.included_messages > 0 ? mms.used_messages / mms.included_messages : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium tabular-nums">
          {mms.used_messages.toLocaleString()}
        </span>
        <span className="text-muted-foreground">
          of {mms.included_messages.toLocaleString()} included
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={mms.included_messages}
        aria-valuenow={Math.min(mms.used_messages, mms.included_messages)}
        aria-label={`${mms.used_messages} of ${mms.included_messages} included picture messages used`}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-200 ease-out",
            warning ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Photos you send in texts use these. When they&apos;re used up, new sends
        go out as text only — your message still reaches your customer, without
        the photo — so your messaging bill can&apos;t run past your plan.
      </p>
    </div>
  );
}

function monthLabel(month: string, long = false): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, (monthNumber ?? 1) - 1, 1).toLocaleDateString(
    undefined,
    long ? { month: "long", year: "numeric" } : { month: "short" },
  );
}

/** G8: 6-month history bars — petrol fill, tabular counts, month labels. */
function HistoryBars({ history }: { history: UsageMonth[] }) {
  const max = Math.max(1, ...history.map((entry) => entry.segments));
  return (
    <div
      role="img"
      aria-label={`Messages sent by month: ${history
        .map((entry) => `${monthLabel(entry.month, true)}: ${entry.segments}`)
        .join(". ")}.`}
    >
      <div aria-hidden className="flex items-end gap-2 sm:gap-3">
        {history.map((entry) => (
          <div
            key={entry.month}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <span className="text-xs tabular-nums text-muted-foreground">
              {entry.segments.toLocaleString()}
            </span>
            <div className="flex h-24 w-full max-w-14 items-end">
              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-200 ease-out",
                  entry.segments === 0 ? "h-0.5 bg-border" : "bg-chart-1",
                )}
                style={
                  entry.segments === 0
                    ? undefined
                    : {
                        height: `${Math.max(4, Math.round((entry.segments / max) * 100))}%`,
                      }
                }
              />
            </div>
            <span className="text-xs text-tertiary">
              {monthLabel(entry.month)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsageSettingsPage() {
  const usage = useUsage();
  const company = useCompany();

  const pending = usage.isPending || company.isPending;
  const error = usage.isError || company.isError;

  return (
    <SettingsPage
      title="Usage"
      description="Outgoing messages this billing period."
    >
      {pending ? (
        <div className="space-y-4" aria-label="Loading usage">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : error ? (
        <LoadError
          onRetry={() => {
            void usage.refetch();
            void company.refetch();
          }}
        />
      ) : usage.data.period_start === null ? (
        <SettingsCard>
          <CalmEmptyState
            icon={<Gauge strokeWidth={1.5} aria-hidden />}
            title="Your message count starts with your subscription"
            description="Once your plan is live, this is where you'll watch what you've used each period."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/billing">See billing</Link>
              </Button>
            }
          />
        </SettingsCard>
      ) : (
        <div className="space-y-8">
          <SettingsCard title="This period">
            <PeriodMeter usage={usage.data} />
          </SettingsCard>

          {usage.data.history.length > 0 && (
            <SettingsCard
              title="Last 6 months"
              description="Outgoing messages by calendar month."
            >
              <HistoryBars history={usage.data.history} />
            </SettingsCard>
          )}

          <SettingsCard title="Storage">
            <StorageMeter storage={usage.data.storage} />
          </SettingsCard>

          {usage.data.voice.included_minutes > 0 && (
            <SettingsCard title="Call forwarding">
              <VoiceMeter voice={usage.data.voice} />
            </SettingsCard>
          )}

          {usage.data.mms.included_messages > 0 && (
            <SettingsCard title="Picture messages">
              <MmsMeter mms={usage.data.mms} />
            </SettingsCard>
          )}

          <SettingsCard
            title="Overage cap"
            description="A safety limit on how far past your included messages a busy month can go."
          >
            <CapControl
              current={normalizeMultiplier(company.data.overage_cap_multiplier)}
              includedSegments={usage.data.included_segments}
            />
            {(() => {
              const multiplier = normalizeMultiplier(
                company.data.overage_cap_multiplier,
              );
              const total = capSegments(
                usage.data.included_segments,
                multiplier,
              );
              return total !== null ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Current cap: {capLabel(multiplier)} ={" "}
                  <span className="tabular-nums">{total.toLocaleString()}</span>{" "}
                  messages per period.
                </p>
              ) : null;
            })()}
          </SettingsCard>

          <SettingsCard title="How messages are counted">
            <p className="text-sm text-muted-foreground">
              Texts are counted in segments. A plain text fits 160 characters
              per segment; texts with emoji fit 70; longer texts use more than
              one. A picture message counts as 3. Incoming texts are always
              free and don&apos;t count.
            </p>
          </SettingsCard>
        </div>
      )}
    </SettingsPage>
  );
}
