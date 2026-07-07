/**
 * <BrowserFrame>, minimal stone browser chrome around arbitrary children
 * (VISUALS §1B/§4.3, BLUEPRINT §1.3).
 *
 * The reusable desktop framing: a white card, 1px stone border, 10px radius (the
 * app's own card language), a three-dot traffic-light cluster where the leftmost
 * dot is PETROL (the brand accent, per VISUALS §1B), and a neutral URL slot
 * reading `loonext.app/inbox`, quietly reinforcing "it's just the web, no
 * download". Wraps screenshots AND live-DOM product renders alike.
 *
 * The soft ambient shadow is the marketing exception to the app's no-card-shadow
 * rule (BLUEPRINT §1.3), allowed only on framed product visuals; opt out with
 * `flat` for inline calm shots. Light-only v3 surface (white card, --paper-2
 * chrome, hairline rules), reduced-motion safe (no motion here), zero-CLS
 * (children own their box).
 *
 * Server component.
 */

import { cn } from "@/lib/utils";

/** BLUEPRINT §1.3 ambient shadow, the one marketing exception, framed visuals only. */
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
  url = "loonext.app/inbox",
  flat = false,
  className,
  contentClassName,
}: BrowserFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-[color:var(--hairline)] bg-white",
        !flat && AMBIENT_SHADOW,
        className,
      )}
    >
      {/* Chrome bar, three dots (leftmost petrol) + a neutral URL slot. */}
      <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] bg-[color:var(--paper-2)] px-3 py-2">
        <div className="flex gap-1.5" aria-hidden>
          {/* Leftmost dot is the brand petrol (VISUALS §1B); the rest neutral. */}
          <span className="size-2.5 rounded-full bg-[color:var(--petrol)]" />
          <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
          <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
        </div>
        {/* --ink-55 (4.9:1 on white) so the quiet hint clears WCAG AA and reads
            petrol-cast, not warm stone. */}
        <div className="mx-auto flex max-w-[62%] items-center rounded-md bg-white px-3 py-0.5 text-[11px] text-[color:var(--ink-55)]">
          {url}
        </div>
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
