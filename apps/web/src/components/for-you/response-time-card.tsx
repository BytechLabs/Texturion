"use client";

/**
 * #239 — the response-time panel on the home surface.
 *
 * WHAT THIS HAS TO ACHIEVE, before any of the layout matters. The number itself
 * is not the point; the ARC is. "You answer in 4 minutes — down from 3 hours when
 * you started" is the sentence a contractor repeats to another contractor, and it
 * is the reason they do not churn. A panel that leads with a bare median leads
 * with the least persuasive thing it knows.
 *
 * *Applying: Meaningful Highlights & Context — "never just show a chart", and
 * package raw stats into a summary highlight so the user feels accomplishment.*
 *
 * So: the arc is the headline, the median is the number under it, the leak is
 * named next to it, and everything else is behind disclosure.
 *
 * *Applying: Chunking — the panel holds four things at most (arc, median, leak,
 * a way in), and the hours split, p90 and per-number breakdown live behind
 * "Details" rather than making the primary view dense.*
 *
 * *Applying: Loss Aversion — the unanswered count is framed as leads nobody
 * answered, not as a neutral "response rate", and it links into the inbox where
 * something can be done about it. A metric that only congratulates is a metric
 * nobody acts on.*
 *
 * HONESTY IS A DESIGN CONSTRAINT HERE. Every state where we do not know something
 * says so: a workspace too young for a baseline is told that rather than shown an
 * arc drawn against itself, a window with no answered lead shows an em dash
 * instead of "0 sec", and a workspace that got SLOWER is told that too. The issue
 * is explicit that the first disagreement with the crew's gut is what ends the
 * metric's usefulness, and a number that only ever improves is the fastest way
 * there.
 */
import { ArrowRight, Clock, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useResponseTime,
  type ResponseTimeReport,
  type ResponseTimeWindow,
} from "@/lib/api/reports";
import { formatResponseTime, responseArcDirection } from "@loonext/shared";
import { cn } from "@/lib/utils";

const WINDOWS: { days: ResponseTimeWindow; label: string }[] = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

/**
 * The arc, in the words the customer would use.
 *
 * Returns null when there is no arc to draw, so the caller renders the honest
 * fallback rather than a hedged sentence about nothing.
 */
export function arcSentence(report: ResponseTimeReport): string | null {
  const direction = responseArcDirection(report.improved_by_seconds);
  if (!direction || report.baseline?.median_seconds == null) return null;
  const then = formatResponseTime(report.baseline.median_seconds);
  return direction === "faster"
    ? `Down from ${then} when you started`
    : `Up from ${then} when you started`;
}

/** Why there is no arc yet, said plainly rather than left blank. */
export function noArcReason(report: ResponseTimeReport): string {
  if (report.baseline_unavailable === "too_new") {
    return "Your starting point lands once you have been here a fortnight";
  }
  if (report.baseline_unavailable === "no_answered_leads") {
    return "No answered leads in your first two weeks, so there is nothing to compare";
  }
  // A baseline exists and the change is under a minute: the same performance
  // measured twice, which is not a story.
  return "About the same as when you started";
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-app-muted-2">{label}</span>
      <span className="text-[13px] tabular-nums text-app-ink">{value}</span>
    </div>
  );
}

export function ResponseTimeCard() {
  const [days, setDays] = useState<ResponseTimeWindow>(30);
  const [open, setOpen] = useState(false);
  const report = useResponseTime(days);

  return (
    <section>
      <h2 className="flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        <span className="flex items-baseline gap-2">
          Response time
        </span>
        {/* Segmented, not a dropdown: three choices are faster to hit than a
            menu, and the current window stays readable at a glance.
            *Applying: the Safety Principle — a familiar control in a
            conventional place.* */}
        <span className="flex items-center gap-0.5" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              aria-pressed={days === w.days}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 ease-out",
                days === w.days
                  ? "bg-app-ink text-app-white"
                  : "text-app-muted-2 hover:bg-app-hover",
              )}
            >
              {w.label}
            </button>
          ))}
        </span>
      </h2>

      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
        {report.isPending ? (
          // A skeleton rather than a spinner: the shape of the answer is known,
          // so the panel does not reflow when it arrives.
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : report.isError || !report.data ? (
          <div className="px-4 py-4 text-[13px] text-app-muted-2">
            Could not load your response time.{" "}
            <button
              type="button"
              onClick={() => report.refetch()}
              className="underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        ) : report.data.leads === 0 ? (
          // Not a zero. A workspace with no new leads in the window has no
          // response time, and "0 sec" would read as instant service.
          <div className="px-4 py-4">
            <p className="text-[13px] text-app-muted-2">
              No new customers texted you in the last {days} days, so there is
              nothing to measure yet.
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-baseline gap-2">
                <Clock
                  className="size-4 shrink-0 translate-y-[-1px] text-app-muted-2"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {/* The median, large and tabular. Optically nudged rather than
                    mathematically centred against the icon.
                    *Applying: Optical Corrections.* */}
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-app-ink">
                  {formatResponseTime(report.data.median_seconds)}
                </span>
                <span className="text-[13px] text-app-muted-2">
                  to answer a new customer
                </span>
              </div>

              {/* The arc: the accomplishment, and the sentence that gets
                  repeated. Direction-coloured, never hidden when it is the
                  wrong direction. */}
              {(() => {
                const sentence = arcSentence(report.data);
                const direction = responseArcDirection(
                  report.data.improved_by_seconds,
                );
                if (!sentence) {
                  return (
                    <p className="pt-1 text-[13px] text-app-muted-2">
                      {noArcReason(report.data)}
                    </p>
                  );
                }
                const Icon =
                  direction === "faster" ? TrendingDown : TrendingUp;
                return (
                  <p
                    className={cn(
                      "flex items-center gap-1.5 pt-1 text-[13px] font-medium",
                      direction === "faster"
                        ? "text-app-petrol-deep"
                        : "text-app-amber-ink",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    {sentence}
                  </p>
                );
              })()}
            </div>

            {/* The leak, named, and a way to act on it. */}
            {report.data.unanswered > 0 && (
              <Link
                href="/inbox?status=new"
                className="flex items-center gap-2 border-t border-app-line-soft px-4 py-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-app-hover"
              >
                <span className="flex-1 text-app-ink">
                  <span className="font-semibold tabular-nums">
                    {report.data.unanswered}
                  </span>{" "}
                  {report.data.unanswered === 1 ? "lead" : "leads"} nobody
                  answered
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-app-muted-2"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            )}

            <div className="border-t border-app-line-soft">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="w-full px-4 py-2 text-left text-[12px] font-medium text-app-muted-2 transition-colors duration-150 ease-out hover:bg-app-hover"
              >
                {open ? "Hide details" : "Details"}
              </button>
              {open && (
                <div className="border-t border-app-line-soft px-4 py-2">
                  <Row
                    label="Slowest 10% of answers"
                    value={formatResponseTime(report.data.p90_seconds)}
                  />
                  <Row
                    label={`During hours (${report.data.business_hours.leads})`}
                    value={formatResponseTime(
                      report.data.business_hours.median_seconds,
                    )}
                  />
                  <Row
                    label={`After hours (${report.data.after_hours.leads})`}
                    value={formatResponseTime(
                      report.data.after_hours.median_seconds,
                    )}
                  />
                  {report.data.by_member?.map((member) => (
                    <Row
                      key={member.user_id}
                      label={`Member · ${member.answered} answered`}
                      value={formatResponseTime(member.median_seconds)}
                    />
                  ))}
                  {report.data.split_truncated && (
                    // Said out loud. A cap that reports nothing reads as "we
                    // looked at everything".
                    <p className="pt-1.5 text-[11px] text-app-muted-2">
                      The hours split covers your most recent{" "}
                      {report.data.split_row_limit} leads; the numbers above it
                      cover all {report.data.leads}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
