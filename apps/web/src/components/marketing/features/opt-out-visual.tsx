/**
 * Opt-out enforcement visual (features track), /features/compliance.
 *
 * A live-DOM render of two real app behaviors (DESIGN.md G5, SPEC §5): a
 * customer's STOP arriving in the thread, and the app's opted-out composer
 * banner (red tint, "This customer opted out of texting. Sends are blocked.")
 * that replaces the composer so a send to an opted-out number is impossible. It
 * makes "STOP means stop, automatically" concrete, the block is shown in the
 * interface, not just asserted in prose.
 *
 * Server component, static DOM, matches the inbound-bubble + opted-out banner
 * tokens. All numbers are in the 555-01XX safe fictional range (G10).
 */

import { Ban } from "lucide-react";

import { cn } from "@/lib/utils";

export function OptOutVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-[color:var(--hairline)] bg-white p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-[color:var(--ink-55)]">
        Jordan P · (416) 555-0173
      </p>

      {/* The customer's inbound STOP, a normal inbound bubble. */}
      <div className="mt-4 flex flex-col gap-1">
        <div className="max-w-[80%] self-start rounded-[10px] rounded-tl-sm bg-[#F0F4F2] px-3 py-2">
          <p className="text-[15px] leading-normal text-[color:var(--day-ink)]">STOP</p>
        </div>
        {/* The system opt-out event line (G5 centered timeline event). */}
        <p className="mt-1 text-center text-[12px] text-[color:var(--ink-55)]">
          Jordan P opted out · today, 4:12 PM
        </p>
      </div>

      {/* The opted-out banner that REPLACES the composer (G5). Red is the one
          sanctioned destructive/blocked signal (matches the app's opt-out
          banner); petrol would read as "ok", the wrong semantics. Light-only. */}
      <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3">
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600"
          aria-hidden
        >
          <Ban className="size-3.5" strokeWidth={2} />
        </span>
        <p className="text-[13px] leading-snug text-red-800">
          This customer opted out of texting. Sends are blocked.
          <span className="mt-0.5 block text-[12px] text-red-700/80">
            Blocked in the app before it reaches the carrier, no accidental
            texts.
          </span>
        </p>
      </div>
    </div>
  );
}
