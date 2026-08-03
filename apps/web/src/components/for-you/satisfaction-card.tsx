"use client";

/**
 * #313 — the satisfaction panel, next to response time on the home surface.
 *
 * WHAT IT HAS TO ACHIEVE. "Satisfaction alongside response time is the
 * beginnings of an honest picture of how the business is doing." Response time
 * says how fast the business answers; this says whether that mattered. A panel
 * that only ever shows a flattering average adds nothing to the pair.
 *
 * *Applying: Meaningful Highlights & Context — the arc is the headline, not the
 * mean. "4.6, up from 4.1" is a sentence about a business getting better; "4.6"
 * is a number nobody can act on.*
 *
 * *Applying: Loss Aversion — the jobs that needed a call back are named and
 * linked, not folded into a satisfaction percentage. A metric that only
 * congratulates is a metric nobody acts on, and these are the ones where
 * somebody was already woken up.*
 *
 * *Applying: Chunking — four things in the primary view (average, arc, the
 * jobs that needed a call back, a way in). The distribution and the per-person
 * breakdown live behind "Details".*
 *
 * HONESTY IS THE WHOLE DESIGN CONSTRAINT. #313 is explicit that a per-member
 * score can become a management stick and that a thin sample is noise. Both
 * refusals are the SERVER's — `average` arrives null and `by_member` arrives
 * null — so this component's job is to say which kind of nothing it received,
 * never to fill the gap with something more presentable.
 */
import { ArrowRight, Star, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useSatisfaction,
  type ResponseTimeWindow,
  type SatisfactionReport,
} from "@/lib/api/reports";
import {
  SATISFACTION_COPY,
  formatSatisfaction,
  poorRatingLine,
  satisfactionArcDirection,
} from "@loonext/shared";
import { cn } from "@/lib/utils";

const WINDOWS: { days: ResponseTimeWindow; label: string }[] = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

/**
 * The arc, in the words the owner would use.
 *
 * Null when there is no arc to draw, so the caller says why rather than
 * printing a hedge about nothing.
 */
export function satisfactionArc(report: SatisfactionReport): string | null {
  const direction = satisfactionArcDirection(report.improved_by);
  if (!direction || report.baseline === null) return null;
  const then = formatSatisfaction(report.baseline.average);
  return direction === "better"
    ? `Up from ${then} the month before`
    : `Down from ${then} the month before`;
}

/**
 * Why there is no number yet — and these are four different facts.
 *
 * Collapsing them into one "no data" message is what makes an owner think the
 * feature is broken when it is working exactly as intended.
 */
export function satisfactionGap(report: SatisfactionReport): string {
  if (report.asked === 0) return SATISFACTION_COPY.none_asked;
  if (report.answered === 0) return SATISFACTION_COPY.none_answered;
  return `${SATISFACTION_COPY.too_few} — ${report.answered} of ${report.minimum_sample}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-app-muted-2">{label}</span>
      <span className="text-[13px] tabular-nums text-app-ink">{value}</span>
    </div>
  );
}

export function SatisfactionCard() {
  const [days, setDays] = useState<ResponseTimeWindow>(30);
  const [open, setOpen] = useState(false);
  const report = useSatisfaction(days);

  return (
    <section>
      <h2 className="flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        <span className="flex items-baseline gap-2">Satisfaction</span>
        {/* The same control, in the same place, as the card above it.
            *Applying: the Safety Principle — two panels on one surface that
            take the same input must take it the same way.* */}
        <span
          className="flex items-center gap-0.5"
          role="group"
          aria-label="Window"
        >
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              aria-pressed={days === w.days}
              className={cn(
                "tap-target rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 ease-out",
                days === w.days
                  ? "bg-app-ink text-app-paper"
                  : "text-app-muted-2 hover:bg-app-hover",
              )}
            >
              {w.label}
            </button>
          ))}
        </span>
      </h2>

      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        {report.isPending ? (
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : report.isError || !report.data ? (
          <div className="px-4 py-4 text-[13px] text-app-muted-2">
            Could not load your ratings.{" "}
            <button
              type="button"
              onClick={() => report.refetch()}
              className="underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        ) : report.data.average === null ? (
          // No number, and the reason. Note the poor count still shows if there
          // is one: two answers is too thin to average but not too thin to act
          // on, and burying an unhappy customer behind a sample-size rule would
          // be the panel choosing tidiness over the thing that matters.
          <div className="space-y-2 px-4 py-4">
            <p className="text-[13px] text-app-muted-2">
              {satisfactionGap(report.data)}
            </p>
            {report.data.poor > 0 ? (
              <Link
                href="/inbox"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-app-ink underline-offset-2 hover:underline"
              >
                {poorRatingLine(report.data.poor)}
                <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-baseline gap-2">
                <Star
                  className="size-4 shrink-0 translate-y-[-1px] text-app-muted-2"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-app-ink">
                  {formatSatisfaction(report.data.average)}
                </span>
                <span className="text-[13px] text-app-muted-2">
                  out of 5, from {report.data.answered} answers
                </span>
              </div>

              {(() => {
                const sentence = satisfactionArc(report.data);
                const direction = satisfactionArcDirection(
                  report.data.improved_by,
                );
                if (!sentence) {
                  return (
                    <p className="pt-1 text-[13px] text-app-muted-2">
                      {report.data.baseline === null
                        ? "No month before this one to compare against yet"
                        : "About the same as the month before"}
                    </p>
                  );
                }
                const Icon = direction === "better" ? TrendingUp : TrendingDown;
                return (
                  <p
                    className={cn(
                      "flex items-center gap-1 pt-1 text-[13px] font-medium",
                      direction === "better"
                        ? "text-app-olive-deep"
                        : "text-app-ink",
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={2} aria-hidden />
                    {sentence}
                  </p>
                );
              })()}

              {/* The leak, named and linked. Every one of these already woke
                  somebody the day it happened; the count is here so a month
                  with three reads as a pattern. */}
              {report.data.poor > 0 ? (
                <Link
                  href="/inbox"
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-app-ink underline-offset-2 hover:underline"
                >
                  {poorRatingLine(report.data.poor)}
                  <ArrowRight
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </Link>
              ) : null}
            </div>

            <div className="border-t border-app-line">
              <button
                type="button"
                onClick={() => setOpen((prior) => !prior)}
                aria-expanded={open}
                className="tap-target flex w-full items-center justify-between px-4 py-2.5 text-[13px] text-app-muted-2 transition-colors hover:bg-app-hover"
              >
                {open ? "Hide details" : "Details"}
              </button>

              {open ? (
                <div className="border-t border-app-line px-4 py-2">
                  {[5, 4, 3, 2, 1].map((score) => (
                    <Row
                      key={score}
                      label={score === 1 ? "1 star" : `${score} stars`}
                      value={String(report.data.distribution[String(score)] ?? 0)}
                    />
                  ))}
                  <Row
                    label="Asked"
                    value={`${report.data.asked} in ${days} days`}
                  />

                  {/* Per person, and only when the owner asked for it. The copy
                      says why it is off rather than leaving a blank that reads
                      as a missing feature. */}
                  {report.data.by_member === null ? (
                    <p className="border-t border-app-line pt-2 text-[13px] text-app-muted-2">
                      {SATISFACTION_COPY.per_member_off}
                    </p>
                  ) : (
                    <div className="border-t border-app-line pt-1">
                      {report.data.by_member.map((member) => (
                        <Row
                          key={member.user_id}
                          label={`${member.name ?? "Member"} · ${member.answered} answered`}
                          value={
                            member.average === null
                              ? SATISFACTION_COPY.too_few
                              : formatSatisfaction(member.average)
                          }
                        />
                      ))}
                    </div>
                  )}

                  {report.data.truncated ? (
                    <p className="pt-1 text-[12px] text-app-muted-2">
                      Showing the most recent {report.data.row_limit} ratings.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
