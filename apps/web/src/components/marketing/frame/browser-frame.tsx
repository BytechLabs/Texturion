/**
 * <BrowserFrame>, the v4 browser-chrome hint around arbitrary children
 * (DESIGN-DIRECTION v4 §5.2 PANEL FRAME grammar, Law 10).
 *
 * The reusable desktop framing in the FIRST RESPONSE voice: a white card with
 * the one card shadow, 16px product-panel radius, a three-dot cluster in the
 * Frost wash, and a mono URL chip reading `loonext.com/inbox` ("it's just the
 * web, no download"). No hairline rules anywhere (Law 10): the chrome bar is
 * separated by space, not a border.
 *
 * This is CHROME ONLY. It does not scope its children: real product embeds
 * belong in <PanelFrame> from `@/components/marketing/fr`, which wraps
 * children in `.app-scope` so the product keeps its own petrol tokens
 * (Law 2). BrowserFrame remains for framing non-product content that wants
 * the browser hint.
 *
 * Server component, light-only, reduced-motion safe (no motion), zero-CLS
 * (children own their box).
 */

import { cn } from "@/lib/utils";

export interface BrowserFrameProps {
  children: React.ReactNode;
  /** URL shown in the chrome slot. Defaults to the "it's just the web" hint. */
  url?: string;
  /** Drop the card shadow for a flat, calm inline shot. */
  flat?: boolean;
  /** Class on the outer frame (sizing/max-width live here). */
  className?: string;
  /** Class on the inner content well (padding/background for live-DOM renders). */
  contentClassName?: string;
}

export function BrowserFrame({
  children,
  url = "loonext.com/inbox",
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
      {/* Chrome bar: three Frost dots + the mono URL chip (no border, Law 10). */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
          <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
          <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
        </span>
        <span className="fr-mono-data mx-auto rounded-[6px] bg-[color:var(--fr-frost)] px-3 py-1 text-xs text-[color:var(--fr-ink-55)]">
          {url}
        </span>
        {/* Balance spacer so the URL centers against the dots. */}
        <span className="w-9" aria-hidden />
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
