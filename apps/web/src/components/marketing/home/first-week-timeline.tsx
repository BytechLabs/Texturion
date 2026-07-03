/**
 * First-week timeline (§H5 / §0.2), the honest US wait as a designed object, not
 * fine print. Win-first: Day 0 is up and receiving, Canada texts the same day;
 * the US carrier review is a bounded, drawn segment; then US texting turns on.
 *
 * The Day 0 numeral is the second expressive numeral moment (the first is the
 * $29 in the truth bar). Sits on the paper panel. Server component, pure DOM,
 * LCP-safe static. No em-dashes; the marker check is the "done" mark.
 */

import { MarkerCheck } from "@/components/marketing/display";

export function FirstWeekTimeline() {
  return (
    <div className="panel-card rounded-2xl p-6 sm:p-10">
      <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
        {/* Day 0 as art, the numeral escalation. */}
        <div className="text-center lg:text-left">
          <p className="font-mono-mkt text-[13px] font-medium text-[color:var(--graphite)]">
            Day
          </p>
          <p className="display-numeral text-[color:var(--petrol)]">0</p>
          <p className="mt-1 text-[15px] font-medium text-[color:var(--ink)]">
            You&apos;re live, not waiting.
          </p>
        </div>

        {/* The bounded wait, drawn as a designed segment. */}
        <ol className="space-y-4">
          <li className="flex gap-4">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center"
              aria-hidden
            >
              <MarkerCheck className="size-5" color="petrol" draw={false} />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-[color:var(--ink)]">
                Day 0, you&apos;re live, not waiting.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                Your number is up. Receiving texts works. Texting Canadian
                customers works. You can invite the crew and start today.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="font-mono-mkt mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--marker)] bg-[color:var(--marker-40)] text-[10px] font-semibold tabular-nums text-[color:var(--ink)]"
              aria-hidden
            >
              1-7
            </span>
            <div>
              <p className="text-[15px] font-semibold text-[color:var(--ink)]">
                Days 1 to 7, the phone companies review you.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                US carriers require every business that texts to register. We
                filed yours the minute you paid; approval typically takes about
                a week (3 to 7 business days).
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center"
              aria-hidden
            >
              <MarkerCheck className="size-5" color="petrol" draw={false} />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-[color:var(--ink)]">
                Approved. US texting turns on.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                We email you the moment it&apos;s live. Nothing else for you to
                do.
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Progress track, purely decorative: the short live start, the bounded
          review, and the live tail, in petrol and rationed marker yellow. */}
      <div className="mt-8 flex items-center gap-1.5" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--petrol)]" />
        <span className="h-1.5 flex-[3] rounded-full bg-[color:var(--marker)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--petrol)]" />
      </div>
    </div>
  );
}
