"use client";

import { Gauge, OctagonPause, TrendingUp } from "lucide-react";
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
import { useCompany } from "@/lib/api/companies";
import { useUsage } from "@/lib/api/usage";
import type { Usage, UsageMonth } from "@/lib/api/types";
import { capSegments, normalizeMultiplier } from "@/lib/settings/cap-control";
import { useActiveCompany } from "@/lib/company/provider";
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

/** D30 storage lines: human-scale bytes, one decimal above KB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/**
 * #178 'pacing': name what is running hot by comparing each meter against its
 * included allowance (used_segments vs included_segments, voice.used_minutes
 * vs voice.included_minutes). Both past the 80% alert line name both; below
 * it, the hotter share leads.
 */
function pacingSubjects(usage: Usage): ("messages" | "calling minutes")[] {
  const messages =
    usage.included_segments > 0
      ? usage.used_segments / usage.included_segments
      : 0;
  const calling =
    usage.voice.included_minutes > 0
      ? usage.voice.used_minutes / usage.voice.included_minutes
      : 0;
  const HOT = 0.8;
  if (messages >= HOT && calling >= HOT) return ["messages", "calling minutes"];
  if (calling >= HOT) return ["calling minutes"];
  if (messages >= HOT) return ["messages"];
  return calling > messages ? ["calling minutes"] : ["messages"];
}

/**
 * #178 'quiet' — the whole screen for almost every crew, matching what
 * marketing promises: one calm line and the policy, never a meter.
 */
function QuietCard() {
  return (
    <SettingsCard>
      <div className="space-y-2 text-sm">
        <p className="font-medium text-foreground">
          Well within fair use this month.
        </p>
        <p className="text-muted-foreground">
          Almost every crew stays well inside fair use. If usage ever paces
          past what your plan covers, we reach out early, right here.
        </p>
        <p>
          <Link
            href="/legal/fair-use"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            How fair use works
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
  const subjects = pacingSubjects(usage);
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
            An early heads up: {subjects.join(" and ")} are pacing past what
            your plan covers.
          </p>
          <p className="text-muted-foreground">
            {subjects.includes("messages") && (
              <>
                You&apos;ve used{" "}
                <span className="tabular-nums">
                  {usage.used_segments.toLocaleString()}
                </span>{" "}
                of your{" "}
                <span className="tabular-nums">
                  {usage.included_segments.toLocaleString()}
                </span>{" "}
                included messages.{" "}
              </>
            )}
            {subjects.includes("calling minutes") && (
              <>
                You&apos;ve used{" "}
                <span className="tabular-nums">
                  {usage.voice.used_minutes.toLocaleString()}
                </span>{" "}
                of your{" "}
                <span className="tabular-nums">
                  {usage.voice.included_minutes.toLocaleString()}
                </span>{" "}
                included calling minutes.{" "}
              </>
            )}
            {projected > 0 ? (
              <>
                At this pace, that&apos;s about{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {dollars(projected)}
                </span>{" "}
                in extra charges by the end of the period.
              </>
            ) : (
              <>At this pace, this period runs past what your plan includes.</>
            )}
          </p>
          <p className="text-muted-foreground">
            Nothing can bill past the spending cap below. It&apos;s yours to
            set.
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
function pauseSentence(label: CapMeterState["label"], reached: boolean): string {
  if (label === "Sending") {
    return reached
      ? "Sending is paused until you raise the cap or the period rolls over. Incoming texts still arrive, free."
      : "At the cap, sending pauses instead of billing further. Incoming texts still arrive, free.";
  }
  return reached
    ? "Calling is paused until you raise the cap or the period rolls over. Missed callers still get your text-back."
    : "At the cap, calling pauses instead of billing further. Missed callers still get your text-back.";
}

/**
 * #178 'capped' — the owner-set spending cap is approaching (>=90%) or
 * reached on either meter. State it plainly: how close, what pauses, and that
 * the cap is the owner's own protection doing its job.
 */
function CappedCard({ usage }: { usage: Usage }) {
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
              ? "Your spending cap is doing its job."
              : "You're getting close to your spending cap."}
          </p>
          {active.map((state) => {
            const percent = Math.min(
              100,
              Math.floor((state.used / state.cap) * 100),
            );
            return (
              <p key={state.label} className="text-muted-foreground">
                {state.label === "Sending" ? "Messages are" : "Calling minutes are"}{" "}
                at{" "}
                <span className="tabular-nums">
                  {state.used.toLocaleString()}
                </span>{" "}
                of the{" "}
                <span className="tabular-nums">{state.cap.toLocaleString()}</span>{" "}
                you allowed
                {state.used >= state.cap ? (
                  <>. {pauseSentence(state.label, true)}</>
                ) : (
                  <>
                    {" "}
                    (<span className="tabular-nums">{percent}%</span>).{" "}
                    {pauseSentence(state.label, false)}
                  </>
                )}
              </p>
            );
          })}
          <p className="text-muted-foreground">
            Nothing bills past the cap. You can raise or lower it below at any
            time.
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
 * #178: every raw number lives ONLY here, behind the owner-facing details
 * affordance — collapsed by default in every status. No meters, no progress
 * bars: plain figures for the owner who wants them, plus the G8 6-month
 * history bars and the D30 storage lines.
 */
function UsageDetails({ usage }: { usage: Usage }) {
  const pauseAt = usage.cap_segments ?? capSegments(usage.included_segments, null);
  const voice = usage.voice;
  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show the numbers</span>
        <span className="hidden group-open:inline">Hide the numbers</span>
      </summary>
      <div className="mt-2 space-y-6">
        <SettingsCard
          title="This period"
          description={periodRange(usage) ?? undefined}
        >
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Messages:{" "}
              <span className="tabular-nums">
                {usage.used_segments.toLocaleString()}
              </span>{" "}
              sent of{" "}
              <span className="tabular-nums">
                {usage.included_segments.toLocaleString()}
              </span>{" "}
              included.
            </p>
            {usage.overage_segments > 0 && (
              <p>
                <span className="tabular-nums">
                  {usage.overage_segments.toLocaleString()}
                </span>{" "}
                past included so far,{" "}
                <span className="tabular-nums">
                  {dollars(usage.projected_overage_cents)}
                </span>{" "}
                at the overage rate.
              </p>
            )}
            {/* #42: there is no uncapped state — the API clamps a null
                multiplier to the 10x hard ceiling, so a null cap_segments can
                only be legacy data and still names a real pause point. */}
            <p>
              Sending pauses at{" "}
              <span className="tabular-nums">{pauseAt.toLocaleString()}</span>{" "}
              messages
              {usage.cap_segments === null
                ? ", the maximum, which is 10 times your included messages."
                : ", the cap you set."}
            </p>
            {usage.inbound_segments > 0 && (
              <p>
                <span className="tabular-nums">
                  {usage.inbound_segments.toLocaleString()}
                </span>{" "}
                messages received, always free.
              </p>
            )}
          </div>
          {voice.included_minutes > 0 && (
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              <p>
                Calling:{" "}
                <span className="tabular-nums">
                  {voice.used_minutes.toLocaleString()}
                </span>{" "}
                of{" "}
                <span className="tabular-nums">
                  {voice.included_minutes.toLocaleString()}
                </span>{" "}
                included minutes used, both directions.
              </p>
              {voice.overage_minutes > 0 && voice.overage_billed && (
                <p>
                  <span className="tabular-nums">
                    {voice.overage_minutes.toLocaleString()}
                  </span>{" "}
                  extra minutes so far at 1¢ each.
                </p>
              )}
              {voice.cap_minutes !== null && (
                <p>
                  Calling pauses at{" "}
                  <span className="tabular-nums">
                    {voice.cap_minutes.toLocaleString()}
                  </span>{" "}
                  minutes, the same cap.
                </p>
              )}
            </div>
          )}
          {/* #121: storage is free and capless, so these are plain figures,
              never a budget or a bar (D30 lines, #178 details-only). */}
          <p className="mt-4 text-sm text-muted-foreground">
            Storage:{" "}
            <span className="tabular-nums">
              {formatBytes(usage.storage.attachments_bytes)}
            </span>{" "}
            of files on notes,{" "}
            <span className="tabular-nums">
              {formatBytes(usage.storage.mms_bytes)}
            </span>{" "}
            of picture messages. Free on every plan, no caps.
          </p>
        </SettingsCard>

        {usage.history.length > 0 && (
          <SettingsCard
            title="Last 6 months"
            description="Outgoing messages by calendar month."
          >
            <HistoryBars history={usage.history} />
          </SettingsCard>
        )}

        <SettingsCard title="How messages are counted">
          <p className="text-sm text-muted-foreground">
            Texts are counted in segments. A plain text fits 160 characters
            per segment; texts with emoji fit 70; longer texts use more than
            one. A picture message counts as 3. Incoming texts are always
            free and don&apos;t count.
          </p>
        </SettingsCard>
      </div>
    </details>
  );
}

export default function UsageSettingsPage() {
  const usage = useUsage();
  const company = useCompany();
  const { role } = useActiveCompany();

  const pending = usage.isPending || company.isPending;
  const error = usage.isError || company.isError;

  return (
    <SettingsPage
      title="Usage"
      description="Where this period stands under fair use."
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
            title="Fair use starts with your subscription"
            description="Once your plan is live, this is where fair use and your spending cap live."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/billing">See billing</Link>
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

          {/* The owner's protection stays reachable in every status — framed
              as the thing that stops a bill, never as a quota. */}
          <SettingsCard
            title="Spending cap"
            description="A spending cap you control. If a month ever runs that hot, sending and calling pause at the cap instead of billing past what you allowed."
          >
            <CapControl
              current={normalizeMultiplier(company.data.overage_cap_multiplier)}
              includedSegments={usage.data.included_segments}
            />
          </SettingsCard>

          {/* #178: raw numbers only behind the owner-facing details
              affordance, collapsed by default in every status. */}
          {role === "owner" && <UsageDetails usage={usage.data} />}
        </div>
      )}
    </SettingsPage>
  );
}
