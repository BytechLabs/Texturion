/**
 * <BrowserFrame> — minimal stone browser chrome around arbitrary children
 * (VISUALS §1B/§4.3, BLUEPRINT §1.3).
 *
 * The reusable desktop framing: a white card, 1px stone border, 10px radius (the
 * app's own card language), a three-dot traffic-light cluster where the leftmost
 * dot is PETROL (the brand accent, per VISUALS §1B), and a neutral URL slot
 * reading `jobtext.app/inbox` — quietly reinforcing "it's just the web, no
 * download". Wraps screenshots AND live-DOM product renders alike.
 *
 * The soft ambient shadow is the marketing exception to the app's no-card-shadow
 * rule (BLUEPRINT §1.3), allowed only on framed product visuals; opt out with
 * `flat` for inline calm shots. Themeable (stone-50 chrome → stone-900 on dark),
 * reduced-motion safe (no motion here), zero-CLS (children own their box).
 *
 * Server component.
 */

import { cn } from "@/lib/utils";

/** BLUEPRINT §1.3 ambient shadow — the one marketing exception, framed visuals only. */
const AMBIENT_SHADOW = "shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]";

export interface BrowserFrameProps {
  children: React.ReactNode;
  /** URL shown in the chrome slot. Defaults to the "it's just the web" hint. */
  url?: string;
  /** Drop the ambient shadow for a flat, calm inline shot. */
  flat?: boolean;
  /** Class on the outer frame (sizing/max-width live here). */
  className?: string;
  /** Class on the inner content well (padding/background for live-DOM renders). */
  contentClassName?: string;
}

export function BrowserFrame({
  children,
  url = "jobtext.app/inbox",
  flat = false,
  className,
  contentClassName,
}: BrowserFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-border bg-card",
        !flat && AMBIENT_SHADOW,
        className,
      )}
    >
      {/* Chrome bar — three dots (leftmost petrol) + a neutral URL slot. */}
      <div className="flex items-center gap-2 border-b border-border bg-stone-50 px-3 py-2 dark:bg-stone-900">
        <div className="flex gap-1.5" aria-hidden>
          {/* Leftmost dot is the brand petrol (VISUALS §1B); the rest are stone. */}
          <span className="size-2.5 rounded-full bg-primary" />
          <span className="size-2.5 rounded-full bg-stone-300 dark:bg-stone-700" />
          <span className="size-2.5 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>
        {/* stone-500 (not 400) so the quiet hint clears WCAG AA 4.5:1 on white (G11). */}
        <div className="mx-auto flex max-w-[62%] items-center rounded-md bg-white px-3 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {url}
        </div>
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
