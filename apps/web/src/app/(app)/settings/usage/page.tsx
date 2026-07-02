"use client";

import Link from "next/link";

import { CapControl } from "@/components/settings/cap-control";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useUsage } from "@/lib/api/usage";
import type { Usage, UsageMonth } from "@/lib/api/types";
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-3xl font-semibold tabular-nums tracking-tight">
          {usage.used_segments.toLocaleString()}
        </p>
        <p className="text-sm text-muted-foreground">
          of {usage.included_segments.toLocaleString()} included messages used
        </p>
        {periodRange(usage) && (
          <p className="ml-auto text-sm tabular-nums text-muted-foreground">
            {periodRange(usage)}
          </p>
        )}
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={usage.included_segments}
        aria-valuenow={Math.min(usage.used_segments, usage.included_segments)}
        aria-label={`${usage.used_segments} of ${usage.included_segments} included messages used`}
        className="h-3 w-full overflow-hidden rounded-full bg-border"
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
      </div>
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
            <span className="text-xs text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
            Usage shows up here once your subscription starts.{" "}
            <Link
              href="/settings/billing"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              See billing
            </Link>
          </p>
        </SettingsCard>
      ) : (
        <div className="space-y-4">
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
