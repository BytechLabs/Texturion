"use client";

/**
 * #354 — the pipeline panel on the home surface.
 *
 * # What this has to achieve
 *
 * #354 says the win rate is "sitting in the data, uncounted" and calls it "the
 * first honest business metric this product could show an owner". That last
 * word is the design constraint. An owner does not act on a percentage; they
 * act on "three quotes are still waiting on an answer", which is a Monday
 * morning's work and a link straight to it.
 *
 * *Applying: Meaningful Highlights & Context — never just show a number. The
 * insight sentence is the headline and the rate is the figure under it, the
 * same order the response-time panel next door uses.*
 *
 * *Applying: Chunking — four figures at most: quoted, won, still out, and the
 * rate. Median days to win sits in the sentence rather than earning a tile.*
 *
 * *Applying: Loss Aversion — "still waiting on an answer" is money the crew has
 * not been paid yet, and it links into the list where something can be done
 * about it. A metric that only congratulates is a metric nobody opens twice.*
 *
 * # Honesty is the constraint, again
 *
 * The panel disappears when there is nothing true to say. Not a zero state, not
 * an encouraging placeholder: a workspace with no quotes yet is told nothing,
 * because a 0% win rate is a damning verdict on a crew that has simply just
 * started. `pipelineInsight` is silent below five decided jobs for the same
 * reason — a 100% rate off two quotes is noise presented as an achievement, and
 * an owner who repeats it to another contractor has been misled by us.
 */
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

import { ShareBar } from "@/components/ui/share-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { usePipelineReport } from "@/lib/api/reports";
import { cn } from "@/lib/utils";

/**
 * How the rate moved against the period before, or null when there is nothing
 * to compare against.
 *
 * Null rather than "0%" when one side is missing: "unchanged" and "we do not
 * know yet" are different facts, and only one of them is reassuring.
 */
export function rateDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function PipelineCard() {
  const report = usePipelineReport(30);

  if (report.isLoading) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }
  if (!report.data) return null;

  const { current, win_rate: rate, previous_win_rate: previous, insight, stages } =
    report.data;

  // Nothing quoted in the window is nothing to say. A panel that appears anyway
  // would be telling a crew who have not sent a quote that they have a 0% win
  // rate, which is untrue and discouraging in the same breath.
  if (current.quoted === 0) return null;

  const delta = rateDelta(rate, previous);
  const quoteStage = stages.find((s) => s.stage === "quote_sent");

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-muted-foreground">
            Quotes, last 30 days
          </h2>
          {/* The sentence leads, not the figure. It is the part somebody
              repeats, and the part they can act on. */}
          <p className="mt-1 text-[15px] font-medium text-app-ink">
            {insight ??
              `${current.quoted} ${current.quoted === 1 ? "quote" : "quotes"} sent. Too early to call a win rate.`}
          </p>
        </div>
        {rate !== null && (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-app-ink">
              {rate}%
            </div>
            {delta !== null && delta !== 0 && (
              <div
                className={cn(
                  "flex items-center justify-end gap-1 text-xs tabular-nums",
                  delta > 0 ? "text-emerald-600" : "text-muted-foreground",
                )}
              >
                {delta > 0 ? (
                  <TrendingUp className="size-3" strokeWidth={1.75} aria-hidden />
                ) : (
                  <TrendingDown className="size-3" strokeWidth={1.75} aria-hidden />
                )}
                {delta > 0 ? "+" : ""}
                {delta} pts
              </div>
            )}
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
        {(
          [
            ["Quoted", current.quoted],
            ["Won", current.won],
            ["Still out", current.open],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-app-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {/* #540: what the month is MADE of, under the three figures it describes.
          A ring was the wrong shape here — it would force won, still-out and
          gone-quiet into one arc and lose the middle one, which is the only one
          anybody can still act on. The remainder is deliberately left as bare
          track: 5 won and 3 out of 10 quoted means 2 went quiet, and stretching
          the parts to fill the bar would hide the number worth chasing.
          *Applying: Meaningful Highlights — the picture carries the same three
          facts the figures above it do, in the shape a glance can read.* */}
      <ShareBar
        className="mt-3"
        total={current.quoted}
        segments={[
          { label: "Won", value: current.won, className: "bg-app-olive-deep" },
          { label: "Still out", value: current.open, className: "bg-app-olive/45" },
        ]}
        label={`Of ${current.quoted} quoted, ${current.won} won and ${current.open} still out`}
      />

      {/* Loss Aversion, and the only action on the card: the outstanding work,
          one tap away. Linked through the STAGE's tag id rather than a name,
          so a crew who renamed the tag still lands on their own list. */}
      {current.open > 0 && quoteStage && (
        <Link
          href={`/inbox?status=open&tag=${quoteStage.tag_id}`}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Chase the {current.open} still waiting
          <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </section>
  );
}
