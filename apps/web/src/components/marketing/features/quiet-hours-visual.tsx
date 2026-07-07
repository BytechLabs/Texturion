/**
 * Quiet-hours nudge visual (features track), /features/compliance.
 *
 * A live-DOM render of the app's quiet-hours dialog (SPEC §5, DESIGN.md G5):
 * when you START a new conversation with someone between 8pm and 8am in their
 * local time, Loonext checks first ("It's 9:14 PM for this customer. Send
 * anyway?". Send / Wait). It's a nudge, not a hard block, and it never fires on
 * replies. Rendering the real dialog makes the scoped behavior unmistakable.
 *
 * Server component, static DOM, matches the app's dialog tokens. The time zone
 * is inferred from the customer's area code (SPEC §5). Safe fictional number.
 */

import { Moon } from "lucide-react";

import { cn } from "@/lib/utils";

export function QuietHoursVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto max-w-sm rounded-2xl border border-[color:var(--hairline)] bg-white p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      <span
        className="flex size-10 items-center justify-center rounded-full bg-[color:var(--petrol-12)] text-[color:var(--petrol)]"
        aria-hidden
      >
        <Moon className="size-5" strokeWidth={1.75} />
      </span>

      <p className="mt-4 text-[16px] font-semibold text-[color:var(--day-ink)]">
        It&apos;s 9:14 PM for this customer.
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
        You&apos;re starting a new conversation late in their evening. Send
        anyway, or wait until morning?
      </p>

      <div className="mt-5 flex gap-3">
        <span className="flex-1 rounded-lg border border-[color:var(--hairline)] bg-white px-4 py-2 text-center text-[14px] font-medium text-[color:var(--ink-70)]">
          Wait
        </span>
        <span className="flex-1 rounded-lg bg-[color:var(--petrol)] px-4 py-2 text-center text-[14px] font-medium text-white">
          Send anyway
        </span>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--ink-70)]">
        Only when you <em>start</em> a late-night conversation, replies are
        never held up.
      </p>
    </div>
  );
}
