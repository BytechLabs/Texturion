/**
 * FiledStamp (iteration 5, ART-DIRECTION §5.1 — the one signature motion beat).
 *
 * The petrol "FILED" stamp that presses in when a ticket resolves — the brand's
 * single moment of character (the getting-on-top-of-it dopamine hit). The
 * keyframe (`jt-stamp-in`: scale 1.18→1 + opacity 0→1, 150ms ease-out,
 * compositor-only) lives in ledger.css.tsx and only runs under
 * prefers-reduced-motion: no-preference; otherwise the stamp is simply present.
 *
 * `stamped` gates the animation: pass false for the resting/SSR state (present,
 * un-animated) and flip to true when the visitor files the job, so the press
 * plays exactly once on the state change. The word "FILED" is ledger vocabulary
 * a plumber reads like the intake pad — felt, not insider jargon (§10.3 keeps
 * "dispatch/ledger/console" out of copy; "FILED" is a stamp, not a label).
 *
 * Server-safe: no hooks, no JS beyond the CSS animation the caller triggers.
 */

import { cn } from "@/lib/utils";

export function FiledStamp({
  stamped = false,
  className,
}: {
  /** True once the visitor files the job — plays the 150ms press once. */
  stamped?: boolean;
  className?: string;
}) {
  return (
    <span
      data-stamped={stamped ? "true" : "false"}
      className={cn(
        "jt-stamp inline-flex select-none items-center rounded-[4px] border-2 border-primary/70 px-2 py-0.5 text-[13px] font-bold uppercase tracking-[0.14em] text-primary",
        className,
      )}
      aria-hidden
    >
      Filed
    </span>
  );
}
