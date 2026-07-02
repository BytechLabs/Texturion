/**
 * First-week timeline (Track B) — §3.5 / §0.2, the expressive honesty object.
 *
 * The page's ONE bold gesture (BLUEPRINT §0.2): the honest US wait rendered
 * LARGE and beautiful, win-first (SPEC §4.1). Day 0 uses the numeral-display
 * scale (the second and last of the two big moments; the first is the $29 in
 * the truth bar). Copy verbatim from COPY §H5.
 *
 * Server component — pure SVG/DOM, no JS, part of the LCP-safe static render.
 */

import { Check } from "lucide-react";

export function FirstWeekTimeline() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">
      <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
        {/* Day 0 as art — the numeral-display escalation (§1.1). */}
        <div className="text-center lg:text-left">
          <p className="text-[13px] font-medium text-muted-foreground">Day</p>
          <p className="display-numeral text-primary">0</p>
          <p className="mt-1 text-[15px] font-medium text-foreground">
            You&apos;re live, not waiting.
          </p>
        </div>

        {/* The bounded wait, drawn as a designed segment, not fine print. */}
        <ol className="space-y-4">
          <li className="flex gap-4">
            <span
              className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <Check className="size-3.5" strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                Day 0 — you&apos;re live, not waiting.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                Your number is up. Receiving texts works. Texting Canadian
                customers works. You can invite the crew and start today.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-[11px] font-semibold tabular-nums text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-warning"
              aria-hidden
            >
              1–7
            </span>
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                Days 1–7 — the phone companies review you.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                US carriers require every business that texts to register. We
                filed yours the minute you paid; approval typically takes about
                a week (3–7 business days).
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <Check className="size-3.5" strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                Approved — US texting turns on.
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                We email you the moment it&apos;s live. Nothing else for you to
                do.
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Progress track, purely decorative. */}
      <div className="mt-8 flex items-center gap-1.5" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-primary" />
        <span className="h-1.5 flex-[3] rounded-full bg-gradient-to-r from-amber-300 to-amber-200 dark:from-amber-700/60 dark:to-amber-800/40" />
        <span className="h-1.5 flex-1 rounded-full bg-primary" />
      </div>
    </div>
  );
}
