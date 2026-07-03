/**
 * SignalCheck (iteration 5, ART-DIRECTION §2.3, REFERENCES craft #10).
 *
 * The universal "done" glyph: a petrol dot that resolves into a check, drawn
 * via SVG `stroke-dashoffset` (Column's self-drawing check technique). Same
 * visual idea as the app's D14 done-mark, so it's honest and on-brand. Used for
 * every included-feature check (pricing, bento, FAQ) and the hero's Delivered
 * beat.
 *
 * The draw keyframe (`jt-draw`) lives in ledger.css.tsx and only runs under
 * prefers-reduced-motion: no-preference; otherwise the check renders pre-drawn.
 * `drawn` gates it (default true = draw on reveal). Server-safe.
 */

import { cn } from "@/lib/utils";

export function SignalCheck({
  className,
  drawn = true,
  strokeWidth = 2.5,
}: {
  className?: string;
  /** Whether to play the draw animation (motion-safe); false = static drawn. */
  drawn?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("jt-check size-4 text-primary", className)}
      data-drawn={drawn ? "true" : "false"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        className="jt-check-path"
        d="M3.5 8.5 6.5 11.5 12.5 5"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
