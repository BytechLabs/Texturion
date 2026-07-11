"use client";

import { Gauge, TrendingUp } from "lucide-react";
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
  UsageMonth,
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
  return `${start} to ${end}`;
}

/** #85/#95: a resource's meter surfaces at or above this share of its limit —
 *  the SAME 80% the static usage-alert emails fire at, so a customer who gets
 *  that email always finds the matching meter here (never a dead-end). */
const METER_WARN_RATIO = 0.8;
function nearLimit(used: number, limit: number): boolean {
  return limit > 0 && used / limit >= METER_WARN_RATIO;
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
            over your included amount:{" "}
            <span className="font-medium tabular-nums">
              {dollars(usage.projected_overage_cents)}
            </span>{" "}
            in overage on your next invoice.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No overage this period. {dollars(0)} extra so far.
          </p>
        )}
        {/* #42: there is no uncapped state any more — the API clamps a null
            multiplier to the 10× hard ceiling. A null cap_segments can only be
            legacy/edge data, so we still state a real pause point (the maximum,
            10× included) rather than the abolished "sending never pauses". */}
        <p className="text-muted-foreground">
          Sending pauses at{" "}
          <span className="tabular-nums">
            {(usage.cap_segments ?? capSegments(usage.included_segments, null))
              .toLocaleString()}
          </span>{" "}
          messages
          {usage.cap_segments === null
            ? ", the maximum, which is 10 times your included messages."
            : "."}
        </p>
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

/** #12/D36/D38: calling minutes (both directions — forwarded calls AND calls
 *  placed from the app) vs the fair-use allowance. Past the allowance, extra
 *  minutes bill at 1¢ each (mirroring the texts meter); calling only pauses
 *  at the spending cap. #133 grandfathered: nothing bills — the copy promises
 *  the pause instead. This is an in-app honesty surface, so concrete figures
 *  are allowed here (D34). */
function VoiceMeter({ voice }: { voice: UsageVoice }) {
  const ratio =
    voice.included_minutes > 0
      ? voice.used_minutes / voice.included_minutes
      : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const warning = ratio >= 0.8;
  const overMinutes = voice.overage_minutes;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium tabular-nums">
          {voice.used_minutes.toLocaleString()} min
        </span>
        <span className="text-muted-foreground">
          of {voice.included_minutes.toLocaleString()} included
        </span>
        {overMinutes > 0 && voice.overage_billed && (
          <span className="text-warning">
            {overMinutes.toLocaleString()} extra at 1¢ each
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={voice.included_minutes}
        aria-valuenow={Math.min(voice.used_minutes, voice.included_minutes)}
        aria-label={`${voice.used_minutes} of ${voice.included_minutes} included calling minutes used`}
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
      {voice.overage_billed ? (
        <p className="text-sm text-muted-foreground">
          Calls forwarded to your cell and calls you place from the app share
          these minutes. Past the included minutes, extra minutes bill at 1¢
          each on your next invoice
          {voice.cap_minutes !== null && (
            <>
              , up to your spending cap ({voice.cap_minutes.toLocaleString()}{" "}
              min)
            </>
          )}
          . At the cap, calling pauses — callers get your missed-call text
          instead — so the bill can never run past what you allowed.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Calls forwarded to your cell and calls you place from the app share
          these minutes. When they&apos;re used up, calling pauses until your
          next period and missed callers still get your text-back — nothing
          extra is ever billed.
        </p>
      )}
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

/**
 * #85/#93: the conditional overage heads-up. Shown ONLY when the dynamic
 * end-of-period projection says the tenant is pacing past what their plan
 * covers — otherwise the usage screen stays quiet (the fair-use posture). It
 * surfaces the projected extra charge and points at the spending cap below,
 * which is the control the customer can actually turn. This is the surface the
 * #92 warning email links to.
 */
function OverageProjectionNotice({ usage }: { usage: Usage }) {
  const projected = usage.overage_projection.projected_overage_cents;
  return (
    <SettingsCard>
      <div className="flex items-start gap-3">
        <TrendingUp
          className="mt-0.5 size-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden
        />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">
            You&apos;re on track to go past what your plan covers this period.
          </p>
          <p className="text-muted-foreground">
            {projected > 0 ? (
              <>
                At your current pace, that&apos;s about{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {dollars(projected)}
                </span>{" "}
                in extra charges by the end of the period.{" "}
              </>
            ) : (
              <>Your usage is running higher than usual this period. </>
            )}
            You control the spending cap below, so charges never grow past a
            limit you set.
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

/**
 * #85/#95: the CALM current-period view, shown when usage is comfortably within
 * plan (not trending over). Usage is stated as plain counts — no "of N" ceiling,
 * no progress bar — the fair-use posture: we stay quiet and email you if that
 * ever changes, so you can just text. The detailed limit meters appear only when
 * the dynamic projection says you're trending over.
 */
function CalmPeriodSummary({ usage }: { usage: Usage }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="app-emotional-number app-motion-message-in text-foreground">
          {usage.used_segments.toLocaleString()}
        </span>
        <p className="pb-0.5 text-sm text-muted-foreground">
          messages sent this period
        </p>
        {periodRange(usage) && (
          <Tertiary as="p" className="ml-auto pb-0.5 text-sm tabular-nums">
            {periodRange(usage)}
          </Tertiary>
        )}
      </div>
      {usage.inbound_segments > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums">
            {usage.inbound_segments.toLocaleString()}
          </span>{" "}
          received this period, always free.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        You&apos;re comfortably within your plan this period. We&apos;ll email
        you if that ever changes, so you can just text.
      </p>
    </div>
  );
}

export default function UsageSettingsPage() {
  const usage = useUsage();
  const company = useCompany();

  const pending = usage.isPending || company.isPending;
  const error = usage.isError || company.isError;
  // #85/#95: the detailed limit meters surface only when they matter — either
  // the tenant is trending over what they pay (the dynamic projection), or a
  // specific resource is near its own limit (the same 80% the static alerts
  // email at, so a warning email never points at a hidden meter). Otherwise the
  // screen stays calm: plain counts + the always-reachable cap control.
  const data = usage.data;
  const trending = data?.overage_projection.trending_over ?? false;
  const showMessages =
    trending ||
    (!!data && nearLimit(data.used_segments, data.included_segments));
  // #121: no storage gate — storage is free and capless, so it is not a
  // usage concern and has no card on this page at all.
  // #133: any calling activity shows the meter — below 80% there was
  // previously NO place in the app to see calling minutes at all. Zero
  // usage stays calm (module off / nobody calls -> no card).
  const showVoice =
    !!data &&
    data.voice.included_minutes > 0 &&
    (data.voice.used_minutes > 0 ||
      trending ||
      nearLimit(data.voice.used_minutes, data.voice.included_minutes));
  // #97/#103: no picture-message meter — pictures count 3 segments each in the
  // message meter above, with no separate cap.

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
          {trending && <OverageProjectionNotice usage={usage.data} />}

          <SettingsCard title="This period">
            {showMessages ? (
              <PeriodMeter usage={usage.data} />
            ) : (
              <CalmPeriodSummary usage={usage.data} />
            )}
          </SettingsCard>

          {/* #85/#95: each per-limit meter surfaces only when that resource is
              near its own limit, or the tenant is trending over. The matching
              static alert emails at the same threshold, so nothing goes
              unwatched — the meter just stays calm until it matters. */}
          {showVoice && (
            <SettingsCard title="Calling">
              <VoiceMeter voice={usage.data.voice} />
            </SettingsCard>
          )}

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
