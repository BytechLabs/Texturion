/**
 * Opt-out enforcement embed (features crew), /features/compliance.
 *
 * Two real app behaviors in sequence (SPEC §5, components/thread): a
 * customer's STOP arriving as a normal inbound bubble (border + app-white
 * fill, the real bubble anatomy), the system opt-out event line, and the
 * banner that REPLACES the composer (composer-banners.tsx, verbatim: "This
 * customer opted out of texting. Sends are blocked." on the destructive
 * tint). The block is shown in the interface, not asserted in prose.
 *
 * Law 2: PRODUCT content, app tokens only (the app's warm-clay destructive,
 * never a marketing color); mount inside <PanelFrame>.
 * Server component, static DOM, 555-01XX safe fictional number.
 */

import { Ban } from "lucide-react";

import { cn } from "@/lib/utils";

export function OptOutVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 sm:p-5", className)}>
      <p className="text-[13px] font-medium text-app-muted">
        Jordan P · <span className="tabular-nums">(416) 555-0173</span>
      </p>

      {/* The customer's STOP: the real inbound bubble anatomy. */}
      <div className="mt-4 flex flex-col gap-1">
        <div className="max-w-[80%] self-start rounded-app-bub border border-app-line bg-app-white px-3.5 py-2.5 [border-top-left-radius:5px]">
          <p className="text-[15px] leading-normal text-app-ink">STOP</p>
        </div>
        {/* The centered system event line the thread draws. */}
        <p className="mt-1 text-center text-[12px] text-app-muted-2">
          Jordan P opted out · today, 4:12 PM
        </p>
      </div>

      {/* The banner that replaces the composer (composer-banners.tsx tone:
          destructive tint; the app's warm clay, its own blocked signal). */}
      <div className="mt-3 flex items-start gap-2.5 rounded-app-card border border-destructive/30 bg-destructive/10 p-3">
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive"
          aria-hidden
        >
          <Ban className="size-3.5" strokeWidth={2} />
        </span>
        <p className="text-[13px] leading-snug text-app-ink">
          This customer opted out of texting. Sends are blocked.
          <span className="mt-0.5 block text-[12px] text-app-muted">
            Rejected in the app before it reaches the carrier. No accidental
            texts.
          </span>
        </p>
      </div>
    </div>
  );
}
