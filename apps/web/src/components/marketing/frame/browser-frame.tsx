/**
 * <BrowserFrame>, the clean desktop card around arbitrary children
 * (DESIGN-DIRECTION v4 §5.2 PANEL FRAME grammar, Law 10).
 *
 * The reusable desktop framing in the FIRST RESPONSE voice: a white card with
 * the one card shadow and the 16px product-panel radius — nothing else. #84:
 * the faux-browser chrome (three-dot "Mac shell" cluster + mono URL chip) was
 * removed; it read as an AI-generated screenshot mock rather than the calm,
 * first-party product surface the site is going for. No hairline rules
 * anywhere (Law 10).
 *
 * This does not scope its children: real product embeds belong in <PanelFrame>
 * from `@/components/marketing/fr`, which wraps children in `.app-scope` so the
 * product keeps its own petrol tokens (Law 2). BrowserFrame remains for framing
 * non-product content on the calm card surface.
 *
 * Server component, light-only, reduced-motion safe (no motion), zero-CLS
 * (children own their box).
 */

import { cn } from "@/lib/utils";

export interface BrowserFrameProps {
  children: React.ReactNode;
  /** Drop the card shadow for a flat, calm inline shot. */
  flat?: boolean;
  /** Class on the outer frame (sizing/max-width live here). */
  className?: string;
  /** Class on the inner content well (padding/background for live-DOM renders). */
  contentClassName?: string;
}

export function BrowserFrame({
  children,
  flat = false,
  className,
  contentClassName,
}: BrowserFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-[color:var(--fr-card)]",
        !flat && "shadow-[var(--fr-shadow-card)]",
        className,
      )}
    >
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
