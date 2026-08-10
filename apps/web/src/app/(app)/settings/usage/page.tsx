"use client";

import type { BillingCurrency } from "@loonext/shared";
import { Gauge, OctagonPause, TrendingUp } from "lucide-react";
import Link from "next/link";

import { CapControl } from "@/components/settings/cap-control";
import { CalmEmptyState } from "@/components/settings/empty-state";
import { AiUsage } from "@/components/settings/ai-usage";
import { StorageBreakdown } from "@/components/settings/storage-breakdown";
import { ExportUsage } from "@/components/settings/export-usage";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useUsage } from "@/lib/api/usage";
import type { Usage, UsageMonth } from "@/lib/api/types";
import { capSegments, normalizeMultiplier } from "@/lib/settings/cap-control";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/**
 * #522: money in the currency the workspace is actually charged in.
 *
 * This hardcoded `currency: "USD"` — harmless while every workspace really was
 * billed USD, and actively wrong the moment one is not: the API now prices these
 * figures at the customer's own rates, so a hardcoded label would have printed a
 * CA$40 overage as "US$40". Worse than the bug it replaced, which is exactly the
 * trap this issue keeps setting.
 *
 * The currency arrives ON the payload rather than being read from the company
 * row, so the number and its label cannot come from two different places.
 */
function dollars(cents: number, currency: BillingCurrency = "usd"): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    // A Canadian reading their own invoice should see "$40.00", not "CA$40.00" —
    // the qualifier belongs on a foreign price, and this is their own money.
    currencyDisplay: "narrowSymbol",
  });
}

function periodRange(t: Translate, usage: Usage): string | null {
  if (!usage.period_start || !usage.period_end) return null;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(usage.period_start).toLocaleDateString(
    undefined,
    options,
  );
  const end = new Date(usage.period_end).toLocaleDateString(undefined, options);
  return t("appShell.usagePeriodRange", { start, end });
}

/**
 * #178 'pacing': name what is running hot by comparing each meter against its
 * included allowance (used_segments vs included_segments, voice.used_minutes
 * vs voice.included_minutes). Both past the 80% alert line name both; below
 * it, the hotter share leads.
 */
function pacingSubjects(usage: Usage): ("messages" | "calling")[] {
  const messages =
    usage.included_segments > 0
      ? usage.used_segments / usage.included_segments
      : 0;
  const calling =
    usage.voice.included_minutes > 0
      ? usage.voice.used_minutes / usage.voice.included_minutes
      : 0;
  const HOT = 0.8;
  // #228/D100: these are DISCRIMINATORS, not labels. The subject used to be its
  // own English name, so translating the sentence would have silently broken
  // the `includes` branches that read it.
  if (messages >= HOT && calling >= HOT) return ["messages", "calling"];
  if (calling >= HOT) return ["calling"];
  if (messages >= HOT) return ["messages"];
  return calling > messages ? ["calling"] : ["messages"];
}

/**
 * #178 'quiet' — the whole screen for almost every crew, matching what
 * marketing promises: one calm line and the policy, never a meter.
 */
function QuietCard() {
  const t = useT();
  return (
    <SettingsCard>
      <div className="space-y-2 text-sm">
        <p className="font-medium text-foreground">
          {t("appShell.usageQuietHeadline")}
        </p>
        <p className="text-muted-foreground">
          {t("appShell.usageQuietBody")}
        </p>
        <p>
          <Link
            href="/legal/fair-use"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t("appShell.usageFairUseLink")}
          </Link>
        </p>
      </div>
    </SettingsCard>
  );
}

/**
 * #178 'pacing' — the early, specific warning the fair-use promise is built
 * on: which meter is running hot, the projected extra charges from the #85
 * dynamic projection, and a pointer at the spending cap as protection. The
 * #92 warning email links here.
 */
function PacingCard({ usage }: { usage: Usage }) {
  const t = useT();
  const subjects = pacingSubjects(usage);
  const subjectList = subjects
    .map((subject) =>
      subject === "messages"
        ? t("appShell.usageSubjectMessages")
        : t("appShell.usageSubjectCallingMinutes"),
    )
    .join(t("appShell.usageSubjectJoiner"));
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
            {t("appShell.usagePacingHeadline", { subjects: subjectList })}
          </p>
          {/* Each figure keeps its own tabular-nums span, so the sentence is
              split at the numbers rather than carrying markup in a key. */}
          <p className="text-muted-foreground">
            {subjects.includes("messages") && (
              <>
                {t("appShell.usageUsedBefore")}{" "}
                <span className="tabular-nums">
                  {usage.used_segments.toLocaleString()}
                </span>{" "}
                {t("appShell.usageUsedOfYour")}{" "}
                <span className="tabular-nums">
                  {usage.included_segments.toLocaleString()}
                </span>{" "}
                {t("appShell.usageIncludedMessages")}{" "}
              </>
            )}
            {subjects.includes("calling") && (
              <>
                {t("appShell.usageUsedBefore")}{" "}
                <span className="tabular-nums">
                  {usage.voice.used_minutes.toLocaleString()}
                </span>{" "}
                {t("appShell.usageUsedOfYour")}{" "}
                <span className="tabular-nums">
                  {usage.voice.included_minutes.toLocaleString()}
                </span>{" "}
                {t("appShell.usageIncludedMinutes")}{" "}
              </>
            )}
            {projected > 0 ? (
              <>
                {t("appShell.usageProjectionBefore")}{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {dollars(projected, usage.currency)}
                </span>{" "}
                {t("appShell.usageProjectionAfter")}
              </>
            ) : (
              <>{t("appShell.usageProjectionUnpriced")}</>
            )}
          </p>
          <p className="text-muted-foreground">
            {t("appShell.usageCapProtects")}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

/** One meter's cap state, for the 'capped' card. */
interface CapMeterState {
  /** What pauses: "Sending" for texts, "Calling" for minutes. */
  label: "Sending" | "Calling";
  used: number;
  cap: number;
}

function capMeterStates(usage: Usage): CapMeterState[] {
  const states: CapMeterState[] = [];
  // #42: a null cap can only be legacy/edge data — resolve to the 10x hard
  // ceiling, the same way the API clamps a null write.
  const segmentsCap =
    usage.cap_segments ?? capSegments(usage.included_segments, null);
  if (segmentsCap > 0) {
    states.push({ label: "Sending", used: usage.used_segments, cap: segmentsCap });
  }
  if (usage.voice.cap_minutes !== null && usage.voice.cap_minutes > 0) {
    states.push({
      label: "Calling",
      used: usage.voice.used_minutes,
      cap: usage.voice.cap_minutes,
    });
  }
  return states;
}

/** What pauses at the cap, per meter, stated plainly. */
function pauseSentence(
  t: Translate,
  label: CapMeterState["label"],
  reached: boolean,
): string {
  if (label === "Sending") {
    return reached
      ? t("appShell.usagePauseSendingReached")
      : t("appShell.usagePauseSendingAhead");
  }
  return reached
    ? t("appShell.usagePauseCallingReached")
    : t("appShell.usagePauseCallingAhead");
}

/**
 * #178 'capped' — the owner-set spending cap is approaching (>=90%) or
 * reached on either meter. State it plainly: how close, what pauses, and that
 * the cap is the owner's own protection doing its job.
 */
function CappedCard({ usage }: { usage: Usage }) {
  const t = useT();
  const states = capMeterStates(usage);
  const reached = states.filter((s) => s.used >= s.cap);
  const near = states.filter((s) => s.used < s.cap && s.used >= 0.9 * s.cap);
  const active = reached.length > 0 ? reached : near.length > 0 ? near : states;
  const isReached = reached.length > 0;

  return (
    <SettingsCard>
      <div className="flex items-start gap-3">
        <OctagonPause
          className="mt-0.5 size-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden
        />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">
            {isReached
              ? t("appShell.usageCapReachedHeadline")
              : t("appShell.usageCapNearHeadline")}
          </p>
          {active.map((state) => {
            const percent = Math.min(
              100,
              Math.floor((state.used / state.cap) * 100),
            );
            return (
              <p key={state.label} className="text-muted-foreground">
                {state.label === "Sending"
                  ? t("appShell.usageMeterMessages")
                  : t("appShell.usageMeterCalling")}{" "}
                {t("appShell.usageMeterAt")}{" "}
                <span className="tabular-nums">
                  {state.used.toLocaleString()}
                </span>{" "}
                {t("appShell.usageMeterOfThe")}{" "}
                <span className="tabular-nums">{state.cap.toLocaleString()}</span>{" "}
                {t("appShell.usageMeterYouAllowed")}
                {state.used >= state.cap ? (
                  <>. {pauseSentence(t, state.label, true)}</>
                ) : (
                  <>
                    {" "}
                    (<span className="tabular-nums">{percent}%</span>).{" "}
                    {pauseSentence(t, state.label, false)}
                  </>
                )}
              </p>
            );
          })}
          <p className="text-muted-foreground">
            {t("appShell.usageCapAdjustable")}
          </p>
        </div>
      </div>
    </SettingsCard>
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
  const t = useT();
  const max = Math.max(1, ...history.map((entry) => entry.segments));
  return (
    <div
      role="img"
      aria-label={t("appShell.usageHistoryAria", {
        months: history
          .map((entry) => `${monthLabel(entry.month, true)}: ${entry.segments}`)
          .join(". "),
      })}
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
 * #178: every raw number lives ONLY here, behind the owner-facing details
 * affordance — collapsed by default in every status. No meters, no progress
 * bars: plain figures for the owner who wants them, plus the G8 6-month
 * history bars and the D30 storage lines.
 */
function UsageDetails({ usage }: { usage: Usage }) {
  const t = useT();
  const pauseAt = usage.cap_segments ?? capSegments(usage.included_segments, null);
  const voice = usage.voice;
  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">
          {t("appShell.usageShowNumbers")}
        </span>
        <span className="hidden group-open:inline">
          {t("appShell.usageHideNumbers")}
        </span>
      </summary>
      <div className="mt-2 space-y-6">
        <SettingsCard
          title={t("appShell.usageThisPeriod")}
          description={periodRange(t, usage) ?? undefined}
        >
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              {t("appShell.usageMessagesLabel")}{" "}
              <span className="tabular-nums">
                {usage.used_segments.toLocaleString()}
              </span>{" "}
              {t("appShell.usageSentOf")}{" "}
              <span className="tabular-nums">
                {usage.included_segments.toLocaleString()}
              </span>{" "}
              {t("appShell.usageIncludedSuffix")}
            </p>
            {usage.overage_segments > 0 && (
              <p>
                <span className="tabular-nums">
                  {usage.overage_segments.toLocaleString()}
                </span>{" "}
                {t("appShell.usagePastIncluded")}{" "}
                <span className="tabular-nums">
                  {dollars(usage.projected_overage_cents, usage.currency)}
                </span>{" "}
                {t("appShell.usageAtOverageRate")}
              </p>
            )}
            {/* #42: there is no uncapped state — the API clamps a null
                multiplier to the 10x hard ceiling, so a null cap_segments can
                only be legacy data and still names a real pause point. */}
            <p>
              {t("appShell.usageSendingPausesAt")}{" "}
              <span className="tabular-nums">{pauseAt.toLocaleString()}</span>{" "}
              {t("appShell.usageMessagesWord")}
              {usage.cap_segments === null
                ? t("appShell.usageCapIsMaximum")
                : t("appShell.usageCapIsYours")}
            </p>
            {usage.inbound_segments > 0 && (
              <p>
                <span className="tabular-nums">
                  {usage.inbound_segments.toLocaleString()}
                </span>{" "}
                {t("appShell.usageMessagesReceived")}
              </p>
            )}
          </div>
          {voice.included_minutes > 0 && (
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              <p>
                {t("appShell.usageCallingLabel")}{" "}
                <span className="tabular-nums">
                  {voice.used_minutes.toLocaleString()}
                </span>{" "}
                {t("appShell.usageOf")}{" "}
                <span className="tabular-nums">
                  {voice.included_minutes.toLocaleString()}
                </span>{" "}
                {t("appShell.usageIncludedMinutesUsed")}
              </p>
              {voice.overage_minutes > 0 && voice.overage_billed && (
                <p>
                  <span className="tabular-nums">
                    {voice.overage_minutes.toLocaleString()}
                  </span>{" "}
                  {t("appShell.usageExtraMinutes")}
                </p>
              )}
              {voice.cap_minutes !== null && (
                <p>
                  {t("appShell.usageCallingPausesAt")}{" "}
                  <span className="tabular-nums">
                    {voice.cap_minutes.toLocaleString()}
                  </span>{" "}
                  {t("appShell.usageMinutesSameCap")}
                </p>
              )}
            </div>
          )}
          {/* #121: storage is free and capless, so this is a COMPOSITION (what
              is in there), never a budget — the bar has no maximum and no
              remaining. Voicemail recordings appear here from migration
              20260724100000; before it they were stored but never shown. */}
          <div className="mt-4">
            <StorageBreakdown storage={usage.storage} />
          </div>
        </SettingsCard>

        {(usage.ai?.length ?? 0) > 0 && (
          <SettingsCard
            title={t("appShell.usageLouTitle")}
            description={t("appShell.usageLouDescription")}
          >
            <AiUsage features={usage.ai ?? []} />
          </SettingsCard>
        )}

        {usage.history.length > 0 && (
          <SettingsCard
            title={t("appShell.usageLastSixMonths")}
            description={t("appShell.usageLastSixMonthsDescription")}
          >
            <HistoryBars history={usage.history} />
          </SettingsCard>
        )}

        <SettingsCard title={t("appShell.usageCountingTitle")}>
          <p className="text-sm text-muted-foreground">
            {t("appShell.usageCountingBody")}
          </p>
        </SettingsCard>
      </div>
    </details>
  );
}

/** Human name for a destination bucket. */
function countryLabel(t: Translate, code: string): string {
  if (code === "US") return t("appShell.usageCountryUs");
  if (code === "CA") return t("appShell.usageCountryCa");
  return t("appShell.usageCountryElsewhere");
}

/**
 * #426 — "are my texts arriving?"
 *
 * The largest single reason buyers leave a texting provider is the suspicion
 * that messages are not landing, and until now a customer had no way to check.
 * The suspicion is what moves them and it was unfalsifiable, so it won by
 * default.
 *
 * Two deliberate choices, both from the issue's own devil's advocate:
 *
 * SMALL NUMBERS LIE. Below the sample floor the API sends `rate: null` and this
 * shows COUNTS instead. A shop sending forty texts a week reads one failure as
 * 2.5%, which looks alarming and almost always means a disconnected number —
 * manufacturing the exact anxiety the figure exists to remove.
 *
 * THE NAME IS THE HONEST PART. "Carrier-reported" rather than "delivered": a
 * receipt means a carrier acknowledged handoff, not that a person read it.
 */
function DeliveryCard({ usage }: { usage: Usage }) {
  const t = useT();
  const delivery = usage.delivery;
  if (!delivery) return null;

  const settled = delivery.delivered + delivery.failed;
  if (settled === 0 && delivery.pending === 0) return null;

  // Split only when there is more than one destination — a single-country
  // shop does not need a table telling it that all its texts went to Canada.
  const countries = delivery.by_country.filter(
    (row) => row.delivered + row.failed + row.pending > 0,
  );

  return (
    <SettingsCard
      title={t("appShell.usageDeliveryTitle")}
      description={t("appShell.usageDeliveryDescription")}
    >
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-medium">
            {t("appShell.usageDeliveryConfirmed", {
              count: delivery.delivered.toLocaleString(),
            })}
          </span>
          {delivery.failed > 0 ? (
            <>
              {" · "}
              {t("appShell.usageDeliveryFailed", {
                count: delivery.failed.toLocaleString(),
              })}
            </>
          ) : null}
          {delivery.pending > 0 ? (
            <>
              {" · "}
              {t("appShell.usageDeliveryPending", {
                count: delivery.pending.toLocaleString(),
              })}
            </>
          ) : null}
        </p>

        {countries.length > 1 ? (
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {countries.map((row) => (
              <li key={row.country} className="flex justify-between gap-4">
                <span>{countryLabel(t, row.country)}</span>
                <span className="tabular-nums">
                  {row.rate === null
                    ? t("appShell.usageDeliveryOfTotal", {
                        delivered: row.delivered.toLocaleString(),
                        total: (row.delivered + row.failed).toLocaleString(),
                      })
                    : `${Math.round(row.rate * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {delivery.failed > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("appShell.usageDeliveryFailureHint")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("appShell.usageDeliveryNoBounces")}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function UsageSettingsPage() {
  const t = useT();
  const usage = useUsage();
  const company = useCompany();
  const { role } = useActiveCompany();

  const pending = usage.isPending || company.isPending;
  const error = usage.isError || company.isError;

  return (
    <SettingsPage
      title={t("appShell.usageTitle")}
      description={t("appShell.usageDescription")}
    >
      {pending ? (
        <div className="space-y-4" aria-label={t("appShell.usageLoading")}>
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
            title={t("appShell.usageNoPlanTitle")}
            description={t("appShell.usageNoPlanDescription")}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/billing">
                  {t("appShell.usageSeeBilling")}
                </Link>
              </Button>
            }
          />
        </SettingsCard>
      ) : (
        <div className="space-y-8">
          {/* #178: the status the API derived is the whole story. 'quiet' is
              the overwhelming default — one calm line, zero meters, matching
              the fair-use promise on the marketing site word for word. */}
          {usage.data.status === "pacing" ? (
            <PacingCard usage={usage.data} />
          ) : usage.data.status === "capped" ? (
            <CappedCard usage={usage.data} />
          ) : (
            <QuietCard />
          )}

          {/* #426: the question that precedes cancelling. Placed above the
              spending cap because "are my texts landing" outranks "what will
              this cost" for someone who is already worried. */}
          <DeliveryCard usage={usage.data} />

          {/* The owner's protection stays reachable in every status — framed
              as the thing that stops a bill, never as a quota. */}
          <SettingsCard
            title={t("appShell.usageSpendingCapTitle")}
            description={t("appShell.usageSpendingCapDescription")}
          >
            <CapControl
              current={normalizeMultiplier(company.data.overage_cap_multiplier)}
              includedSegments={usage.data.included_segments}
            />
          </SettingsCard>

          {/* #304: the file for whoever does the books, beside the numbers it
              describes. Absent for anybody without `billing.manage`, which is
              the bookkeeper's whole preset — so this is one of the few
              surfaces they see and an owner-only check would hide it from the
              person it is for. */}
          <SettingsCard
            title={t("appShell.usageExportTitle")}
            description={t("appShell.usageExportDescription")}
          >
            <ExportUsage />
          </SettingsCard>

          {/* #178: raw numbers only behind the owner-facing details
              affordance, collapsed by default in every status. */}
          {role === "owner" && <UsageDetails usage={usage.data} />}
        </div>
      )}
    </SettingsPage>
  );
}
